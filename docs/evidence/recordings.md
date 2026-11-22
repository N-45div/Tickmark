# Evidence: Kane CLI recordings of every check

The latest passing Kane CLI run for each check, recorded in TestMu Test Manager. Each link opens
the run: every step Kane took in Chrome, what it read, and each assertion. They also stand in for
the live checks if a reviewer can't run Kane themselves.

| Check | Case | Rulebook | Result | Recording |
| --- | --- | --- | --- | --- |
| `intra-state` | Karnataka → Karnataka: CGST + SGST | india-gst | ✅ passed (2026-11-20) | [open recording](https://test-manager.lambdatest.com/projects/01M7PH5DV3VEKD8RMCCWKTVV9A/test-cases/01M7X6N4V4X4PFFT958VB12Y4X/dashboard/share/US_6MKQ8HQLCTX703V099DU7E704VR19FH3S7PZLKG6QZF2SD6G4FRSZRSWB5TZ3GRE?type=summary&agentView=true&fqdn=summary-page) |
| `inter-state` | Karnataka → Maharashtra: IGST | india-gst | ✅ passed (2026-11-20) | [open recording](https://test-manager.lambdatest.com/projects/01M7PH5DV3VEKD8RMCCWKTVV9A/test-cases/01M7X6N4H2ZQ4S6DM84PRT2NCA/dashboard/share/US_4CASQXE552X2YL63Z1C3MZY3ZN34SOXPLQYRC3OPADYLXAWVYPSD8EBIZYMJWMVK?type=summary&agentView=true&fqdn=summary-page) |
| `union-territory` | Karnataka → Chandigarh (Union Territory): IGST | india-gst | ✅ passed (2026-11-20) | [open recording](https://test-manager.lambdatest.com/projects/01M7PH5DV3VEKD8RMCCWKTVV9A/test-cases/01M7X6N4G3EHJQ46T1KFQR3D0F/dashboard/share/US_PRBNDH7782M1L2B0Z32RMU676QW6LHRHON157IH8Z049BNEZQY2UN3KST228UTDN?type=summary&agentView=true&fqdn=summary-page) |
| `unregistered-buyer` | Unregistered consumer in Maharashtra, mixed GST rates | india-gst | ✅ passed (2026-11-20) | [open recording](https://test-manager.lambdatest.com/projects/01M7PH5DV3VEKD8RMCCWKTVV9A/test-cases/01M7X6N44RNYAM2P5GDTA9B8P9/dashboard/share/US_73ODGB25CJ920RNJVSBU8P7WOCRYLZVE4M0OEKAMA34M011YSL0QBX94C0H8BTMO?type=summary&agentView=true&fqdn=summary-page) |
| `us-taxable-goods` | Texas, nexus: tax only the taxable line | us-sales-tax | ✅ passed (2026-11-22) | [open recording](https://test-manager.lambdatest.com/projects/01M7PH5DV3VEKD8RMCCWKTVV9A/test-cases/01M82EZXNH75QHWH95C35FP6TC/dashboard/share/US_9MMCYH5CPTC7BXOECL5ISLP5CWNVPWG0IXKP6I4M7UC4Q8H4FWBQ9CXKA3J929D0?type=summary&agentView=true&fqdn=summary-page) |
| `us-no-nexus` | Colorado, no nexus: no sales tax | us-sales-tax | ✅ passed (2026-11-22) | [open recording](https://test-manager.lambdatest.com/projects/01M7PH5DV3VEKD8RMCCWKTVV9A/test-cases/01M82EZXZ50F54TYC6M980BMCH/dashboard/share/US_94QPANRL9VW4UXUYNL3AW6M6UN5Q16VDAHN5AKRWYXY4SWYFTOA9HQGCVK0IZ21G?type=summary&agentView=true&fqdn=summary-page) |
| `us-exempt-reseller` | California reseller with a resale certificate: exempt | us-sales-tax | ✅ passed (2026-11-22) | [open recording](https://test-manager.lambdatest.com/projects/01M7PH5DV3VEKD8RMCCWKTVV9A/test-cases/01M82EZXKQBH6A6GNJN94FG71E/dashboard/share/US_5UXJ36KIAPZ55W9I2AXRQYX0GV6G8MVMUNUWWXUDQWY1FJJNVHXVZGTB5C1X8RSS?type=summary&agentView=true&fqdn=summary-page) |
| `us-no-sales-tax-state` | Oregon: no statewide sales tax | us-sales-tax | ✅ passed (2026-11-22) | [open recording](https://test-manager.lambdatest.com/projects/01M7PH5DV3VEKD8RMCCWKTVV9A/test-cases/01M82EZX2VS20JJCPPJCBRA243/dashboard/share/US_KHSXUM9WUELZA791NEO27HWFU8WMBZ9VGXFQ8YEJL4ZA76LOAD94Z4C6ZDGBCCA5?type=summary&agentView=true&fqdn=summary-page) |
| `india-interstate-invoice` | Editor: bill a Mumbai client, expect IGST 18% | editor flow | ✅ passed (2026-11-22) | [open recording](https://test-manager.lambdatest.com/projects/01M7PH5DV3VEKD8RMCCWKTVV9A/test-cases/01M82EZXFVW4FDH60JY6CCHRWK/dashboard/share/US_VXMJZX1PAT661R0PNQJXFGQIBBH9HFARYKHZNM9OEO0ZOEYFE0PO67ED2EASFCB8?type=summary&agentView=true&fqdn=summary-page) |
| `us-tax-only-taxable-items` | Editor: Texas customer, tax only the taxable item | editor flow | ✅ passed (2026-11-22) | [open recording](https://test-manager.lambdatest.com/projects/01M7PH5DV3VEKD8RMCCWKTVV9A/test-cases/01M82F2FX9JFXQ4YAT86VFJE2T/dashboard/share/US_J0WXVT1Q6W357X26W23LO6L4ZQ0LI2ZFWR91Q2TRS9XJAYBA0BUTB6420OSLFDNB?type=summary&agentView=true&fqdn=summary-page) |

Planted-bug runs (Kane catching real bugs) are linked from [prove.md](prove.md). The Claude Code ⇄ Kane
loop is in [closed-loop.md](closed-loop.md).

Invoice checks also re-add every number in code (`npm run math`, no Kane credits): the arithmetic
rules tagged `[math]` in `kane/rules/` are enforced that way, not by Kane's assertions.
