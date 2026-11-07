# Tredjepartsbibliotek

| Fil | Bibliotek | Version | Källa | Licens |
|---|---|---|---|---|
| `xlsx.full.min.js` | SheetJS Community Edition | 0.20.3 | https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js | Apache-2.0 (`LICENSE-SheetJS.txt`) |

SHA-256 `xlsx.full.min.js`: `cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41`

- Ersätter `xlsx@0.18.5` från jsDelivr (kända sårbarheter CVE-2023-30533 och CVE-2024-22363, rättade i 0.19.3 resp. 0.20.2).
- Lokalt laddas filen från `vendor/`. `scripts/build-lokal.mjs` bäddar in biblioteket i den byggda filen och kontrollerar SHA-256.
- Uppgradera: ladda ned ny version från cdn.sheetjs.com, uppdatera tabellen och SHA-256, kör testerna.
