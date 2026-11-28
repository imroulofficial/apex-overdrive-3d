# v75 vs v74 per car, three tiers

Measured with `tools/perf/cockpit.mjs --switch --frames 10` in headless Chromium on SwiftShader (a CPU renderer: frame times are only comparable with each other, not device numbers). v74 and v75 of the same car and tier ran one right after the other with nothing else running; run-to-run noise is about ±10% (the same build measured twice differed by up to 15%). The cabin texture column leaves out the race's sky map, which the cars and the road share. "Chase" is the follow view, then the race switches to the driver view mid-race ("Cockpit"). The last column counts new shader programs / textures / geometries after the warm-up, then at the chase→cockpit switch (0 = nothing compiled or uploaded during the race). Cabin = the driver-view cabin alone; car tex = the player car's own textures.

### Summary (averages over the 8 cars, v75 vs v74)

| Tier | Chase ms | Chase draws | Cockpit ms | Prepare |
|---|---|---|---|---|
| low | -3% | -0.6 | +14% | -5% |
| medium | +4% | +0.4 | +13% | -8% |
| high | +5% | +0.2 | +24% | -9% |

### Low tier: low-end GPU on Graphics Auto

| Car | Chase ms v74→v75 | Chase draws | Chase tris | Cockpit ms v74→v75 | Cockpit draws | Cabin tris | Cabin tex MB | Car tex MB | Prepare s | New after warm-up · on switch |
|---|---|---|---|---|---|---|---|---|---|---|
| rp1-vanta | 734→718 (-2%) | 93→92 | 324k→321k | 633→746 (+18%) | 92→93 | 14.5k→14.0k | 2.82→2.82 | 5.69→2.69 | 23→24 (+4%) | 0/0/0 · 0/0/0 |
| kz-kestrel | 709→730 (+3%) | 92→92 | 321k→321k | 716→801 (+12%) | 93→93 | 14.5k→14.1k | 2.82→2.82 | 5.69→2.69 | 24→24 (+0%) | 0/0/0 · 0/0/0 |
| sv-stallion | 748→712 (-5%) | 92→92 | 324k→318k | 676→790 (+17%) | 93→93 | 14.5k→14.1k | 2.82→2.82 | 5.69→2.69 | 24→24 (-1%) | 0/0/0 · 0/0/0 |
| rb-ridgeback | 729→717 (-2%) | 93→92 | 323k→322k | 607→734 (+21%) | 93→91 | 14.5k→14.0k | 2.82→2.67 | 5.69→2.69 | 25→22 (-13%) | 0/0/0 · 0/0/0 |
| ag-aurelia | 796→738 (-7%) | 93→92 | 319k→316k | 617→806 (+31%) | 89→90 | 14.5k→14.1k | 2.82→2.82 | 5.69→2.69 | 27→24 (-14%) | 0/0/0 · 0/0/0 |
| mz-monza | 726→681 (-6%) | 92→89 | 320k→308k | 665→711 (+7%) | 93→89 | 14.5k→13.8k | 2.82→3 | 5.69→2.69 | 24→25 (+6%) | 0/0/0 · 0/0/0 |
| tm-tempesta | 726→758 (+4%) | 91→93 | 319k→318k | 772→650 (-16%) | 93→87 | 14.5k→4.9k | 2.82→1.67 | 5.69→4.02 | 26→23 (-10%) | 0/0/0 · 0/0/0 |
| rpx-hyperion | 716→666 (-7%) | 93→92 | 322k→317k | 599→747 (+25%) | 89→91 | 14.5k→13.2k | 2.82→3 | 5.69→2.69 | 27→24 (-11%) | 0/0/0 · 0/0/0 |

### Medium (normal GPU, Graphics Medium: cockpit tier mid)

| Car | Chase ms v74→v75 | Chase draws | Chase tris | Cockpit ms v74→v75 | Cockpit draws | Cabin tris | Cabin tex MB | Car tex MB | Prepare s | New after warm-up · on switch |
|---|---|---|---|---|---|---|---|---|---|---|
| rp1-vanta | 897→929 (+4%) | 106→106 | 393k→393k | 992→1080 (+9%) | 130→135 | 54.8k→38.1k | 7.69→7.43 | 5.69→7.35 | 37→33 (-12%) | 0/0/0 · 0/0/0 |
| kz-kestrel | 907→906 (-0%) | 105→106 | 386k→391k | 1010→1145 (+13%) | 132→142 | 54.8k→42.3k | 7.69→7.43 | 5.69→9.78 | 39→34 (-11%) | 0/0/0 · 0/0/0 |
| sv-stallion | 879→973 (+11%) | 106→106 | 398k→387k | 947→1185 (+25%) | 134→140 | 54.8k→40.7k | 7.69→7.43 | 5.69→9.78 | 37→37 (+0%) | 0/0/0 · 0/0/0 |
| rb-ridgeback | 876→858 (-2%) | 106→105 | 392k→387k | 1029→1022 (-1%) | 133→138 | 54.8k→35.5k | 7.69→7.27 | 5.69→7.35 | 36→32 (-13%) | 0/0/0 · 0/0/0 |
| ag-aurelia | 856→917 (+7%) | 106→107 | 390k→392k | 926→1086 (+17%) | 132→136 | 54.8k→41.6k | 7.69→7.43 | 5.69→9.78 | 37→37 (+2%) | 0/0/0 · 0/0/0 |
| mz-monza | 850→979 (+15%) | 105→105 | 393k→379k | 975→1218 (+25%) | 129→137 | 54.8k→36.6k | 7.69→7.69 | 5.69→7.35 | 37→33 (-11%) | 0/0/0 · 0/0/0 |
| tm-tempesta | 1172→1020 (-13%) | 104→107 | 380k→384k | 1126→1044 (-7%) | 131→134 | 54.8k→7.8k | 7.69→6.08 | 5.69→11.11 | 44→34 (-23%) | 0/0/0 · 0/0/0 |
| rpx-hyperion | 812→889 (+9%) | 106→105 | 394k→386k | 903→1098 (+22%) | 130→138 | 54.8k→35.9k | 7.69→7.69 | 5.69→7.35 | 35→36 (+3%) | 0/0/0 · 0/0/0 |

### High (normal GPU, Graphics High)

| Car | Chase ms v74→v75 | Chase draws | Chase tris | Cockpit ms v74→v75 | Cockpit draws | Cabin tris | Cabin tex MB | Car tex MB | Prepare s | New after warm-up · on switch |
|---|---|---|---|---|---|---|---|---|---|---|
| rp1-vanta | 1009→1059 (+5%) | 108→107 | 424k→417k | 1271→1412 (+11%) | 131→136 | 54.8k→38.1k | 25.69→15.69 | 5.69→5.1 | 45→43 (-5%) | 0/0/0 · 0/0/0 |
| kz-kestrel | 921→1098 (+19%) | 107→108 | 421k→424k | 1244→1741 (+40%) | 134→141 | 54.8k→42.3k | 25.69→15.69 | 5.69→9.78 | 46→47 (+1%) | 0/0/0 · 0/0/0 |
| sv-stallion | 1083→986 (-9%) | 107→108 | 423k→420k | 1188→1596 (+34%) | 132→141 | 54.8k→40.7k | 25.69→15.69 | 5.69→9.78 | 52→37 (-29%) | 0/0/0 · 0/0/0 |
| rb-ridgeback | 1039→1066 (+3%) | 108→107 | 424k→418k | 1227→1502 (+22%) | 134→139 | 54.8k→35.5k | 25.69→14.85 | 5.69→5.1 | 48→45 (-7%) | 0/0/0 · 0/0/0 |
| ag-aurelia | 926→1045 (+13%) | 108→108 | 423k→416k | 1064→1553 (+46%) | 132→137 | 54.8k→41.6k | 25.69→15.69 | 5.69→8.78 | 42→43 (+2%) | 0/0/0 · 0/0/0 |
| mz-monza | 933→1092 (+17%) | 107→107 | 426k→410k | 1136→1443 (+27%) | 130→138 | 54.8k→36.6k | 25.69→18.85 | 5.69→5.1 | 43→39 (-9%) | 0/0/0 · 0/0/0 |
| tm-tempesta | 1122→1127 (+0%) | 106→109 | 416k→413k | 1360→1215 (-11%) | 135→133 | 54.8k→7.8k | 25.69→12 | 5.69→12.45 | 51→46 (-11%) | 0/0/0 · 0/0/0 |
| rpx-hyperion | 1001→949 (-5%) | 108→107 | 427k→416k | 1202→1470 (+22%) | 135→141 | 54.8k→35.9k | 25.69→18.85 | 5.69→5.1 | 46→41 (-11%) | 0/0/0 · 0/0/0 |

Low-end GPU with Graphics: High chosen by hand (Stallion, v75, unchanged path): cockpit tier high, live mirror, cabin 40.7k tris / 15.69 MB, chase 108 draws, cockpit 141 draws, new after warm-up 0/0/0, on switch 0/0/0.

### Medium tier against the targets (normal GPU, Graphics Medium)

| Target | Result |
|---|---|
| Chase frame within +10% of v74 | Average +4%; per car −13% to +15% (Stallion +11%, Monza +15%; noise about ±10%) |
| Chase draws at most +5 | −1 to +3 per car (was +11 to +21) |
| Cabin textures ≤ 8 MB, 1024 px max, merged materials | 6.08–7.69 MB (was 14.85–18.85 MB): one 1024 px atlas with the baked shading, normal map 256 px, night glow 128 px, gauges 512 px |
| Cockpit frame within +20% of v74 | Average +13%; per car −7% to +25% (Stallion and Monza +25%, Hyperion +22%) |
| Look kept | Same cabin mesh, lit (Lambert with normal map and night glow); the bodywork round the cabin is glossy Lambert with the sky reflected, the windscreen keeps its tint and sky reflection |
| Prepare | Average −8% |
| Nothing compiled, uploaded or allocated during the race | 0/0/0 after warm-up and at the switch |

### Low tier against the targets (low-end GPU, Graphics Auto; accepted, unchanged)

| Target | Result |
|---|---|
| Chase frame within +10% of v74 | Average −3%; per car −7% to +4% |
| Chase draws at most +5 | −3 to +2 per car |
| Player car textures ≤ 6 MB, 512 px | 2.69 MB (Tempesta 4.02 MB) vs 5.69 MB |
| Light cabin ≤ 15k tris, ≤ 4 MB, 512 px | 13.2k–14.1k tris (Tempesta 4.9k), 1.67–3 MB |
| Cockpit frame within +20% of v74 | Average +14%; per car −16% to +31% |
| Prepare within +15% | Average −5% |

### What changed for medium and high (all tiers where free)
- The player car's atlas parts (body trim, cabin, driver, steering wheel, rims and tyres, discs and calipers, painted rims) are one draw, and all its glass (with the door windows) another. Each moving part follows its own group through a matrix array, so the wheels still spin and steer, the steering wheel turns and the windows move.
- Every car part draws front faces only (the Blender parts are closed shells): the back faces cost about a quarter of the driver view.
- High keeps its full cabin and materials; its cockpit frame is +24% on average (Kestrel +40%, Aurelia +46%).
