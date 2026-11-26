"""Shell fuel card importer for the MOL Odoo demo.

Reads a Shell fleet card export (.xlsx or .csv), fills the gaps with stated estimates, writes one fuel
service per transaction into Odoo Fleet, and prints the reply to send back to the person who forwarded it.

  python fuel_agent.py <file>            dry run: show what would be written
  python fuel_agent.py <file> --write    write to Odoo
  python fuel_agent.py <file> --undo     remove what an earlier --write of the same file created

The Odoo API key is never stored here. It is read from the ODOO_API_KEY environment variable, or from the
"odoo-moldemo" entry in ~/.claude.json.
"""
import csv, datetime as dt, difflib, json, os, re, statistics, sys, urllib.request

URL = os.environ.get("ODOO_URL", "https://skytechnext-moldemo-main-42739009.dev.odoo.com")
DB = os.environ.get("ODOO_DB", "skytechnext-moldemo-main-42739009")
TANK = {"Alphard": 75, "Zenix": 52, "Innova": 55, "mu-X": 80, "Montero Sport": 68}   # litres, used for a sanity check only


def api_key():
    k = os.environ.get("ODOO_API_KEY")
    if k:
        return k
    cfg = json.load(open(os.path.expanduser("~/.claude.json"), encoding="utf8"))

    def find(node):
        if isinstance(node, dict):
            if "odoo-moldemo" in node and isinstance(node["odoo-moldemo"], dict):
                return node["odoo-moldemo"].get("env", {}).get("ODOO_API_KEY")
            for v in node.values():
                r = find(v)
                if r:
                    return r
        return None
    k = find(cfg)
    if not k:
        sys.exit("No Odoo API key found. Set ODOO_API_KEY.")
    return k


class Odoo:
    def __init__(self):
        self.key, self.n = api_key(), 0
        self.uid = self.call("common", "authenticate", DB, os.environ.get("ODOO_USER", "admin"), self.key, {})
        if not self.uid:
            sys.exit("Odoo login failed.")

    def call(self, service, method, *args):
        self.n += 1
        body = json.dumps({"jsonrpc": "2.0", "method": "call", "id": self.n, "params": {"service": service, "method": method, "args": list(args)}}).encode()
        r = json.loads(urllib.request.urlopen(urllib.request.Request(URL + "/jsonrpc", body, {"Content-Type": "application/json"}), timeout=120).read())
        if r.get("error"):
            raise RuntimeError(r["error"]["data"].get("message") or str(r["error"]))
        return r["result"]

    def x(self, model, method, *args, **kw):
        return self.call("object", "execute_kw", DB, self.uid, self.key, model, method, list(args), kw)


# ---------- reading the file
HEAD = {"date": ["date", "transaction date", "txn date"], "time": ["time"], "card": ["card"], "plate": ["plate", "vehicle", "registration", "reg no"],
        "driver": ["driver", "cardholder", "card holder"], "product": ["product", "fuel", "grade"], "litres": ["litre", "liter", "volume", "qty", "quantity"],
        "price": ["unit price", "price/l", "price per", "ppl", "price"], "amount": ["amount", "total", "value", "net"], "odo": ["odo", "mileage", "km reading"],
        "station": ["station", "site", "location", "merchant"]}


def rows_of(path):
    if path.lower().endswith((".xlsx", ".xlsm")):
        import openpyxl
        ws = openpyxl.load_workbook(path, data_only=True).active
        data = [[c for c in r] for r in ws.iter_rows(values_only=True)]
    else:
        with open(path, newline="", encoding="utf-8-sig") as f:
            data = list(csv.reader(f))
    # header row = first row that names at least three known columns
    for hi, r in enumerate(data[:15]):
        cols = {}
        for ci, c in enumerate(r):
            t = str(c or "").strip().lower()
            for key, words in HEAD.items():
                if key not in cols and any(w in t for w in words):
                    cols[key] = ci; break
        if len(cols) >= 3:
            out = []
            for n, r2 in enumerate(data[hi + 1:], hi + 2):
                if not any(str(c or "").strip() for c in r2):
                    continue
                out.append(dict({k: (r2[i] if i < len(r2) else None) for k, i in cols.items()}, _row=n))
            return out
    sys.exit("Could not find a header row with date, plate and amount columns.")


def num(v):
    if v is None or str(v).strip() == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = re.sub(r"[^\d.,-]", "", str(v)).replace(",", "")
    try:
        return float(s)
    except ValueError:
        return None


def day(v):
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    s = str(v or "").strip()
    for cand in (s, s.split(" ")[0], s[:11].strip()):
        for f in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%d-%b-%Y", "%d %b %Y", "%Y/%m/%d", "%d-%m-%Y", "%b %d, %Y"):
            try:
                return dt.datetime.strptime(cand, f).date()
            except ValueError:
                pass
    return None


norm = lambda p: re.sub(r"[^A-Z0-9]", "", str(p or "").upper())


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        sys.exit(__doc__)
    path, write, undo = args[0], "--write" in sys.argv, "--undo" in sys.argv
    tag = "SHELL-AGENT:" + os.path.basename(path)
    o = Odoo()
    if undo:
        ids = o.x("fleet.vehicle.log.services", "search", [["inv_ref", "like", tag + ":%"]])
        if ids:
            o.x("fleet.vehicle.log.services", "unlink", ids)
        print("Removed %d fuel records created from %s." % (len(ids), os.path.basename(path)))
        return
    veh = o.x("fleet.vehicle", "search_read", [], fields=["license_plate", "model_id", "driver_employee_id"])
    by_plate = {norm(v["license_plate"]): v for v in veh}
    by_driver = {v["driver_employee_id"][1].lower(): v for v in veh if v["driver_employee_id"]}
    odo = {}
    for r in o.x("fleet.vehicle.odometer", "search_read", [], fields=["vehicle_id", "date", "value"], order="date"):
        odo.setdefault(r["vehicle_id"][0], []).append((dt.date.fromisoformat(r["date"]), r["value"]))
    stype = o.x("fleet.service.type", "search", [["name", "like", "Fuel"]])[0]
    vendor = o.x("res.partner", "search", [["name", "ilike", "Shell Fleet Card"]], limit=1)
    done = {r["inv_ref"] for r in o.x("fleet.vehicle.log.services", "search_read", [["inv_ref", "like", tag + ":%"]], fields=["inv_ref"])}

    rows = rows_of(path)
    prices = [p for p in (num(r.get("price")) for r in rows) if p]
    med_price = statistics.median(prices) if prices else None
    out, seen, last_fill = [], set(), {}
    for r in rows:
        notes, conf = [], "high"

        def low(level, text):
            nonlocal conf
            notes.append(text)
            conf = "low" if level == "low" or conf == "low" else "medium"
        d = day(r.get("date"))
        if not d:
            out.append({"row": r["_row"], "skip": "no readable date"}); continue
        # vehicle
        p = norm(r.get("plate")); v = by_plate.get(p)
        if not v and p:
            alt = p.replace("O", "0") if p[3:] and "O" in p[3:] else p
            m = difflib.get_close_matches(alt, list(by_plate), 1, 0.8)
            if m:
                v = by_plate[m[0]]; low("medium", "plate read as %s, matched to %s" % (r.get("plate"), v["license_plate"]))
        if not v and r.get("driver"):
            m = difflib.get_close_matches(str(r["driver"]).lower(), list(by_driver), 1, 0.75)
            if m:
                v = by_driver[m[0]]; low("medium", "no plate in the file; vehicle taken from the driver, %s" % v["driver_employee_id"][1])
        if not v:
            out.append({"row": r["_row"], "skip": "vehicle not recognised (%s)" % (r.get("plate") or "blank")}); continue
        # litres, price, amount
        L, P, A = num(r.get("litres")), num(r.get("price")), num(r.get("amount"))
        if A is None and L and (P or med_price):
            A = round(L * (P or med_price), 2); low("medium", "amount blank; worked out as litres x price")
        if L is None and A and (P or med_price):
            L = round(A / (P or med_price), 2); low("medium", "litres blank; worked out as amount / %s price of PHP %.2f" % ("its own" if P else "the file's median", P or med_price))
        if A is None:
            out.append({"row": r["_row"], "skip": "no amount and nothing to work it out from"}); continue
        key = (v["id"], d, round(A, 2), str(r.get("time") or ""))
        if key in seen:
            out.append({"row": r["_row"], "skip": "duplicate of an earlier row in this file"}); continue
        seen.add(key)
        model = v["model_id"][1].split("/")[-1]
        if L and L > TANK.get(model, 90) * 1.05:
            low("low", "%.1f L is more than a %s tank holds (%d L); possibly two fills or another vehicle" % (L, model, TANK.get(model, 90)))
        # odometer
        O, est = num(r.get("odo")), False
        hist = [h for h in odo.get(v["id"], []) if h[0] < d]   # readings before the day of the fill
        if O is None and hist:
            O, est = hist[-1][1], True
            low("medium", "odometer blank; estimated at %s km from the driver's last reading before it, on %s" % (format(int(O), ","), hist[-1][0].strftime("%d %b")))
        elif O is None:
            low("medium", "odometer blank and no reading on file to estimate from")
        elif hist and O < hist[-1][1] - 5:
            low("low", "odometer %s is below the last known %s; left out" % (format(int(O), ","), format(int(hist[-1][1]), ","))); O = None
        kml = None
        prev = last_fill.get(v["id"])
        if O and L and prev and O > prev:
            kml = (O - prev) / L
            if not 3 <= kml <= 25:
                low("medium", "%.1f km/L since the last fill is outside the usual range" % kml)
        if O:
            last_fill[v["id"]] = O
        ref = "%s:%s" % (tag, r["_row"])
        out.append({"row": r["_row"], "date": d, "veh": v, "litres": L, "amount": A, "odo": O, "odo_est": est, "kml": kml, "station": str(r.get("station") or "").strip(),
                    "product": str(r.get("product") or "").strip(), "notes": notes, "conf": conf, "ref": ref, "exists": ref in done})

    good = [x for x in out if "skip" not in x]
    created = 0
    if write:
        for x in good:
            if x["exists"]:
                continue
            desc = "Shell card fill%s%s" % (", %.1f L" % x["litres"] if x["litres"] else "", " at " + x["station"] if x["station"] else "")
            vals = {"vehicle_id": x["veh"]["id"], "service_type_id": stype, "date_from": x["date"].isoformat(), "date_to": x["date"].isoformat(), "amount": x["amount"],
                    "description": desc, "inv_ref": x["ref"], "state": "done",
                    "notes": "Imported by the fuel email agent. Confidence: %s.%s" % (x["conf"], (" " + "; ".join(x["notes"]) + ".") if x["notes"] else "")}
            if vendor:
                vals["vendor_id"] = vendor[0]
            if x["veh"]["driver_employee_id"]:
                vals["purchaser_employee_id"] = x["veh"]["driver_employee_id"][0]
            if x["odo"] and not x["odo_est"]:
                vals["odometer"] = x["odo"]
            o.x("fleet.vehicle.log.services", "create", vals); created += 1

    # ---------- the reply
    fname = os.path.basename(path)
    W = lambda s="": print(s)
    total = sum(x["amount"] for x in good)
    W("Subject: Re: Shell fuel card data - %d transactions %s" % (len(good), "filed in Odoo" if write else "read (nothing written yet)"))
    W()
    W("I read %s: %d rows, %d usable transactions, PHP %s in total." % (fname, len(out), len(good), format(total, ",.2f")))
    if write:
        W("%d were added to Odoo Fleet as fuel services%s." % (created, "; %d were already there from an earlier run" % (len(good) - created) if created < len(good) else ""))
    else:
        W("This was a dry run. Nothing has been written to Odoo.")
    W()
    W("%-4s %-7s %-9s %7s %11s %9s  %-6s %s" % ("Row", "Date", "Vehicle", "Litres", "Amount", "Odometer", "Sure?", "What I assumed"))
    for x in good:
        W("%-4s %-7s %-9s %7s %11s %9s  %-6s %s" % (x["row"], x["date"].strftime("%d %b"), x["veh"]["license_plate"], "%.1f" % x["litres"] if x["litres"] else "-",
                                                 format(x["amount"], ",.2f"), (format(int(x["odo"]), ",") + ("*" if x["odo_est"] else "")) if x["odo"] else "-", x["conf"], "; ".join(x["notes"]) or "read as given"))
    skipped = [x for x in out if "skip" in x]
    if skipped:
        W(); W("Not filed:")
        for x in skipped:
            W("  row %s: %s" % (x["row"], x["skip"]))
    W(); W("* estimated odometer; shown here for reference and not written to the vehicle's odometer log.")
    lows = [x for x in good if x["conf"] == "low"]
    if lows:
        W("Please check rows %s, where I am least sure." % ", ".join(str(x["row"]) for x in lows))
    W("To correct a row, reply with the row number and the right value.")


if __name__ == "__main__":
    main()
