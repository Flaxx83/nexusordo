"""Skapar neutrala, påhittade testplaner i Planner Premiums exportformat.

Används av scripts/howto-bilder.mjs för hjälpbilderna i profilen bas (app/howto/bas/<sv|en>/). Allt är påhittat:
projektet "Ny besöksreception" med två delprojekt, egna gater G1–G4 och ansvariga "Testperson A–F".

Kör: python3 exempel/bas/skapa-basplaner.py   (skriver .xlsx-filerna bredvid skriptet)
"""
from datetime import datetime, date
from pathlib import Path
import openpyxl

UT = Path(__file__).parent
FS, PL, GE, TU, OV = ["Förstudie", "Planering", "Genomförande", "Test och utbildning", "Överlämning"]


def d(s, h=9):
    y, m, dd = map(int, s.split("-"))
    return datetime(y, m, dd, h)


def arbetsdagar(a, b):
    x, n = date.fromisoformat(a), 0
    while x <= date.fromisoformat(b):
        n += x.weekday() < 5
        x = date.fromordinal(x.toordinal() + 1)
    return n


def skriv(fil, namn, start, slut, uppgifter, mal):
    """uppgifter: (namn, ansvarig, start, slut, bucket, klart 0–1, beroende_av [nr])
    mal: (gate, status, slutdatum, [nr på kopplade uppgifter])"""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Project tasks"
    klart = sum(u[5] for u in uppgifter) / len(uppgifter)
    for rad in [("Project name", namn), ("Plan owner", "Testdata (fiktiv)"), ("Project start date", d(start)),
                ("Project finish date", d(slut, 17)), ("Duration", f"{arbetsdagar(start, slut)} days"),
                ("% complete", round(klart, 2)), ("Exported on", datetime(2026, 10, 30, 8)), (None,)]:
        ws.append(rad)
    ws.append(["Task number", "Outline number", "Name", "Assigned to", "Start", "Finish", "Duration", "Bucket",
               "% complete", "Priority", "Depends on", "Dependents (after)"])
    efter = {i: [] for i in range(1, len(uppgifter) + 1)}
    for i, u in enumerate(uppgifter, 1):
        for p in u[6]:
            efter[p].append(i)
    for i, (n, ans, s, e, b, k, dep) in enumerate(uppgifter, 1):
        ws.append([str(i), str(i), n, ans, d(s), d(e, 17), f"{arbetsdagar(s, e)} days", b, k, "Medium",
                   ", ".join(f"{p}FS" for p in dep) or None, ", ".join(f"{x}FS" for x in efter[i]) or None])
    g = wb.create_sheet("Project goals")
    g.append(["Name", "Priority", "Status", "Start date", "End date", "Description", "Connected tasks"])
    for gate, status, e, nr in mal:
        g.append([gate, "Medium", status, None, d(e, 10) if e else None, None,
                  ", ".join(f"{x}-{uppgifter[x - 1][0]}" for x in nr)])
    wb.save(UT / fil)
    print("Skrev", fil, len(uppgifter), "aktiviteter")


skriv("Ny besöksreception (fiktiv).xlsx", "Ny besöksreception (fiktiv)", "2026-08-03", "2027-06-25", [
    ("Projektdirektiv", "Testperson A", "2026-08-03", "2026-08-28", FS, 1, []),                  # 1
    ("Behovsinventering besökare", "Testperson B", "2026-08-17", "2026-09-25", FS, 1, [1]),      # 2
    ("Kostnadskalkyl", "Testperson A", "2026-09-14", "2026-10-09", FS, 1, [2]),                  # 3
    ("Ritning reception rev A", "Testperson C", "2026-10-12", "2026-11-20", PL, 0.7, [2]),       # 4
    ("Val av besökssystem", "Testperson D", "2026-10-19", "2026-12-11", PL, 0.4, [3]),           # 5
    ("Upphandling möbler", "Testperson C", "2026-11-23", "2027-01-29", PL, 0.1, [4]),            # 6
    ("Ombyggnad entré", "Testperson E", "2027-02-01", "2027-04-02", GE, 0, [4, 6]),              # 7
    ("Installation besökssystem", "Testperson D", "2027-03-01", "2027-04-16", GE, 0, [5]),       # 8
    ("Test av inpassering", "Testperson D", "2027-04-19", "2027-05-07", TU, 0, [7, 8]),          # 9
    ("Utbildning receptionister", "Testperson F", "2027-05-03", "2027-05-28", TU, 0, [8]),       # 10
    ("Överlämning till förvaltning", "Testperson A", "2027-05-31", "2027-06-18", OV, 0, [9, 10]),  # 11
], [
    ("G1", "Closed", "2026-10-09", [1, 2, 3]),
    ("G2", "On track", "2027-01-29", [4, 5, 6]),
    ("G3", "Not started", "2027-04-16", [7, 8]),
    ("G4", "Not started", "2027-06-25", [9, 10, 11]),
])

skriv("Delprojekt IT – Besökssystem (fiktivt).xlsx", "Delprojekt IT – Besökssystem (fiktivt)", "2026-09-07", "2027-05-14", [
    ("Kravlista besökssystem", "Testperson D", "2026-09-07", "2026-10-16", FS, 1, []),           # 1
    ("Säkerhetsgranskning", "Testperson E", "2026-10-19", "2026-11-27", PL, 0.5, [1]),           # 2
    ("Integration passersystem", "Testperson D", "2026-12-07", "2027-02-26", GE, 0, [2]),        # 3
    ("Systemtest", "Testperson D", "2027-03-01", "2027-03-26", TU, 0, [3]),                      # 4
    ("Driftsatt besökssystem", "Testperson E", "2027-04-12", "2027-04-30", OV, 0, [4]),          # 5
], [
    ("G1", "Closed", "2026-10-16", [1]),
    ("G2", "On track", "2026-11-27", [2]),
    ("G3", "Not started", "2027-03-26", [3, 4]),
    ("G4", "Not started", "2027-05-14", [5]),
])

skriv("Delprojekt Utbildning (fiktivt).xlsx", "Delprojekt Utbildning (fiktivt)", "2026-11-02", "2027-06-11", [
    ("Utbildningsbehov", "Testperson F", "2026-11-02", "2026-12-11", FS, 0.6, []),               # 1
    ("Utbildningsmaterial", "Testperson F", "2027-01-11", "2027-03-19", PL, 0, [1]),             # 2
    ("Pilotutbildning", "Testperson B", "2027-03-22", "2027-04-09", GE, 0, [2]),                 # 3
    ("Utbildning alla receptionister", "Testperson F", "2027-04-19", "2027-05-28", TU, 0, [3]),  # 4
], [
    ("G1", "On track", "2026-12-11", [1]),
    ("G2", "Not started", "2027-03-19", [2]),
    ("G3", "Not started", "2027-04-09", [3]),
    ("G4", "Not started", "2027-06-11", [4]),
])
