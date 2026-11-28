# v75 vs v74 per car, three tiers

Measured with `tools/perf/cockpit.mjs --switch --frames 10` in headless Chromium on SwiftShader (a CPU renderer: frame times are only comparable with each other, not device numbers). v74 and v75 of the same car and tier ran one right after the other with nothing else running; run-to-run noise is about ±10%. "Chase" is the follow view, then the race switches to the driver view mid-race ("Cockpit"). The last column counts new shader programs / textures / geometries after the warm-up, then at the chase→cockpit switch (0 = nothing compiled or uploaded during the race). Cabin = the driver-view cabin alone; car tex = the player car's own textures.

### Summary (averages over the 8 cars, v75 vs v74)

| Tier | Chase ms | Chase draws | Cockpit ms | Prepare |
|---|---|---|---|---|
| low | +1% | -0.1 | +19% | -7% |
| medium | +12% | +13.1 | +36% | -5% |
| high | +6% | +13.0 | +33% | -10% |

### Low tier: low-end GPU on Graphics Auto

| Car | Chase ms v74→v75 | Chase draws | Chase tris | Cockpit ms v74→v75 | Cockpit draws | Cabin tris | Cabin tex MB | Car tex MB | Prepare s | New after warm-up · on switch |
|---|---|---|---|---|---|---|---|---|---|---|
| rp1-vanta | 678→805 (+19%) | 93→92 | 323k→322k | 592→758 (+28%) | 89→92 | 14.5k→14.0k | 2.82→2.82 | 5.69→2.69 | 28→22 (-21%) | 0/0/0 · 0/0/0 |
| kz-kestrel | 753→704 (-7%) | 92→92 | 322k→318k | 792→789 (-0%) | 92→90 | 14.5k→14.1k | 2.82→2.82 | 5.69→2.69 | 25→24 (-3%) | 0/0/0 · 0/0/0 |
| sv-stallion | 730→725 (-1%) | 92→92 | 323k→318k | 608→762 (+25%) | 90→93 | 14.5k→14.1k | 2.82→2.82 | 5.69→2.69 | 25→23 (-8%) | 0/0/0 · 0/0/0 |
| rb-ridgeback | 796→855 (+7%) | 93→92 | 324k→323k | 664→845 (+27%) | 93→92 | 14.5k→14.0k | 2.82→2.67 | 5.69→2.69 | 26→26 (-2%) | 0/0/0 · 0/0/0 |
| ag-aurelia | 767→717 (-6%) | 93→92 | 320k→314k | 692→739 (+7%) | 92→90 | 14.5k→14.1k | 2.82→2.82 | 5.69→2.69 | 28→27 (-4%) | 0/0/0 · 0/0/0 |
| mz-monza | 723→701 (-3%) | 92→92 | 323k→316k | 608→797 (+31%) | 89→93 | 14.5k→13.8k | 2.82→3 | 5.69→2.69 | 24→25 (+5%) | 0/0/0 · 0/0/0 |
| tm-tempesta | 693→754 (+9%) | 90→93 | 315k→318k | 631→710 (+13%) | 81→87 | 14.5k→4.9k | 2.82→1.67 | 5.69→4.02 | 25→22 (-10%) | 0/0/0 · 0/0/0 |
| rpx-hyperion | 791→703 (-11%) | 93→92 | 322k→317k | 594→737 (+24%) | 89→91 | 14.5k→13.2k | 2.82→3 | 5.69→2.69 | 25→22 (-10%) | 0/0/0 · 0/0/0 |

### Medium (normal GPU, Graphics Medium: cockpit tier mid)

| Car | Chase ms v74→v75 | Chase draws | Chase tris | Cockpit ms v74→v75 | Cockpit draws | Cabin tris | Cabin tex MB | Car tex MB | Prepare s | New after warm-up · on switch |
|---|---|---|---|---|---|---|---|---|---|---|
| rp1-vanta | 857→1021 (+19%) | 106→118 | 394k→393k | 965→1325 (+37%) | 131→139 | 54.8k→38.1k | 7.69→15.69 | 5.69→5.1 | 36→34 (-6%) | 0/0/0 · 0/0/0 |
| kz-kestrel | 848→944 (+11%) | 105→118 | 391k→390k | 1011→1391 (+38%) | 134→139 | 54.8k→42.3k | 7.69→15.69 | 5.69→9.78 | 33→34 (+5%) | 0/0/0 · 0/0/0 |
| sv-stallion | 926→988 (+7%) | 106→119 | 399k→394k | 994→1409 (+42%) | 131→143 | 54.8k→40.7k | 7.69→15.69 | 5.69→9.78 | 36→33 (-10%) | 0/0/0 · 0/0/0 |
| rb-ridgeback | 888→980 (+10%) | 107→118 | 399k→394k | 896→1294 (+44%) | 133→137 | 54.8k→35.5k | 7.69→14.85 | 5.69→5.1 | 37→34 (-9%) | 0/0/0 · 0/0/0 |
| ag-aurelia | 844→873 (+3%) | 106→118 | 393k→386k | 963→1318 (+37%) | 131→139 | 54.8k→41.6k | 7.69→15.69 | 5.69→8.78 | 36→34 (-7%) | 0/0/0 · 0/0/0 |
| mz-monza | 845→1009 (+19%) | 105→117 | 395k→378k | 968→1357 (+40%) | 134→138 | 54.8k→36.6k | 7.69→18.85 | 5.69→5.1 | 36→36 (+2%) | 0/0/0 · 0/0/0 |
| tm-tempesta | 860→925 (+8%) | 104→125 | 384k→383k | 1064→1052 (-1%) | 135→139 | 54.8k→7.8k | 7.69→12 | 5.69→12.45 | 36→34 (-5%) | 0/0/0 · 0/0/0 |
| rpx-hyperion | 834→980 (+18%) | 106→117 | 394k→381k | 889→1319 (+48%) | 131→139 | 54.8k→35.9k | 7.69→18.85 | 5.69→5.1 | 36→32 (-12%) | 0/0/0 · 0/0/0 |

### High (normal GPU, Graphics High)

| Car | Chase ms v74→v75 | Chase draws | Chase tris | Cockpit ms v74→v75 | Cockpit draws | Cabin tris | Cabin tex MB | Car tex MB | Prepare s | New after warm-up · on switch |
|---|---|---|---|---|---|---|---|---|---|---|
| rp1-vanta | 884→1055 (+19%) | 108→119 | 424k→417k | 1194→1387 (+16%) | 135→139 | 54.8k→38.1k | 25.69→15.69 | 5.69→5.1 | 46→38 (-18%) | 0/0/0 · 0/0/0 |
| kz-kestrel | 932→975 (+5%) | 107→120 | 422k→423k | 1035→1569 (+52%) | 132→140 | 54.8k→42.3k | 25.69→15.69 | 5.69→9.78 | 39→36 (-10%) | 0/0/0 · 0/0/0 |
| sv-stallion | 944→1004 (+6%) | 107→120 | 424k→419k | 1071→1595 (+49%) | 132→144 | 54.8k→40.7k | 25.69→15.69 | 5.69→9.78 | 40→39 (-3%) | 0/0/0 · 0/0/0 |
| rb-ridgeback | 972→990 (+2%) | 108→119 | 425k→418k | 1128→1403 (+24%) | 134→142 | 54.8k→35.5k | 25.69→14.85 | 5.69→5.1 | 44→38 (-14%) | 0/0/0 · 0/0/0 |
| ag-aurelia | 978→997 (+2%) | 108→120 | 423k→417k | 1080→1506 (+39%) | 131→140 | 54.8k→41.6k | 25.69→15.69 | 5.69→8.78 | 40→42 (+7%) | 0/0/0 · 0/0/0 |
| mz-monza | 1066→1000 (-6%) | 107→119 | 422k→414k | 1094→1500 (+37%) | 131→139 | 54.8k→36.6k | 25.69→18.85 | 5.69→5.1 | 48→42 (-13%) | 0/0/0 · 0/0/0 |
| tm-tempesta | 972→1073 (+10%) | 106→127 | 411k→417k | 1137→1255 (+10%) | 126→142 | 54.8k→7.8k | 25.69→12 | 5.69→12.45 | 45→39 (-13%) | 0/0/0 · 0/0/0 |
| rpx-hyperion | 947→1064 (+12%) | 108→119 | 421k→415k | 1113→1539 (+38%) | 131→142 | 54.8k→35.9k | 25.69→18.85 | 5.69→5.1 | 44→35 (-19%) | 0/0/0 · 0/0/0 |

Low-end GPU with Graphics: High chosen by hand (Stallion, v75, unchanged path): cockpit tier high, live mirror, cabin 40.7k tris / 15.69 MB, chase 120 draws, cockpit 143 draws, new after warm-up 0/0/0, on switch 0/0/0.

### Low tier against the targets

| Target (low-end GPU, Graphics Auto) | Result |
|---|---|
| Chase frame within +10% of v74 | Average +1% (per car −7% to +19%; run-to-run noise is about ±10%) |
| Chase draws at most +5 | −1 to +3 per car |
| Player car textures ≤ 6 MB, 512 px | 2.69 MB (Tempesta 4.02 MB) vs 5.69 MB |
| Car triangles not above v74 | Scene triangles in the chase view are equal or lower (Tempesta +3k) |
| Light cabin ≤ 15k tris, ≤ 4 MB, 512 px, merged materials | 13.2k–14.1k tris (Tempesta 4.9k), 1.67–3 MB, one atlas + gauges, 8 draws |
| Cockpit frame within +20% of v74 | Average +19%; Kestrel, Aurelia and Tempesta within, the other five +25% to +31% |
| Prepare within +15% | Average −7% (every car −21% to +5%) |
| Nothing compiled, uploaded or allocated during the race | 0/0/0 after warm-up and at the switch, every car and tier |

The remaining cockpit gap comes from each car's real cabin: its windscreen and side windows show more of the world than v74's one shared cabin did. The low tier already draws the cabin unlit, leaves out the clear windscreen glass and draws the bodywork round it in Lambert.

The medium and high rows were measured before the low-tier-only changes (front faces only, unlit gauges), which do not touch those tiers.
