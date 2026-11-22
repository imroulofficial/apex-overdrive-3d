// Startup order for ads and Meta measurement (versionCode 70).
//
// 1. Right after the splash, as in v68: the UMP consent request (and the form when one is
//    required), then the Meta re-sync, so a fresh install's first consent answer switches Meta
//    install / app-open measurement on as early as before.
// 2. Once the garage has settled (`delayMs`, then the next idle moment): MobileAds.initialize
//    and the first ad loads, the heavy UI-thread part (ANR fix F4). When and where ads show is
//    unchanged: every placement waits for this step.
//
// Returns the consent → Meta step's promise.
export function startAds({ ads, metaMeasurement, delayMs, later = setTimeout, whenIdle = (fn) => fn() }) {
  const consentAndMeta = ads.consent().then(() => metaMeasurement.sync());
  later(() => whenIdle(() => ads.init()), delayMs);
  return consentAndMeta;
}
