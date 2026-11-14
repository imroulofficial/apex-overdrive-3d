// Decides whether the Meta (Facebook) SDK may run, from the Google UMP consent result the game
// already collects for AdMob. Pure and side-effect free so it can be unit tested under Node;
// metaMeasurement.js reads the inputs and applies the answer.
//
// Inputs:
//   umpStatus        UMP consent status from AdMob.requestConsentInfo / showConsentForm:
//                    'NOT_REQUIRED', 'OBTAINED', 'REQUIRED' or 'UNKNOWN' (undefined if the check failed)
//   gdprApplies      IABTCF_gdprApplies that UMP stores on the device: 1 = GDPR applies (EEA,
//                    UK, Switzerland), 0 = it does not, null = never written
//   purposeConsents  IABTCF_PurposeConsents: '1' or '0' per IAB TCF purpose, purpose 1 first
//   addtlConsent     IABTCF_AddtlConsent: Google Additional Consent string listing the Google ad
//                    tech providers (ATPs) the player consented to, e.g. '2~89.2253~dv.70'
//
// Meta is not an IAB TCF vendor; in Google's consent tools it is ad tech provider 89. So where
// GDPR applies Meta may run only when the player consented to Meta itself (ATP 89 in the
// consented part of the Additional Consent string) and to the two TCF purposes this use needs:
//   1  Store and/or access information on a device (the advertising ID, the SDK's own storage)
//   7  Measure advertising performance (install and app-open attribution for Meta ads)
// Anything missing, unreadable or still pending counts as "no".

export const META_ATP_ID = 89;
export const META_TCF_PURPOSES = [1, 7];

// Ids in the consented part of an Additional Consent string ('1~ids' or '2~ids~dv.ids').
export function acConsentedIds(addtlConsent) {
  if (typeof addtlConsent !== 'string') return [];
  const [version, consented = ''] = addtlConsent.split('~');
  if (version !== '1' && version !== '2') return [];
  return consented
    .split('.')
    .filter((id) => /^\d+$/.test(id))
    .map(Number);
}

export function hasPurposeConsent(purposeConsents, purpose) {
  return typeof purposeConsents === 'string' && purposeConsents.charAt(purpose - 1) === '1';
}

function normalizeGdprApplies(value) {
  if (value === 1 || value === '1' || value === true) return 1;
  if (value === 0 || value === '0' || value === false) return 0;
  return null;
}

// Returns { allowed, reason }. `allowed` true means: start the Meta SDK with automatic app
// events and advertiser ID collection on. False means Meta must receive nothing.
export function decideMetaMeasurement({ umpStatus, gdprApplies, purposeConsents, addtlConsent } = {}) {
  if (normalizeGdprApplies(gdprApplies) === 1) {
    // EEA / UK / Switzerland: the player's own choices in the consent message decide.
    const missing = META_TCF_PURPOSES.filter((p) => !hasPurposeConsent(purposeConsents, p));
    if (missing.length) return { allowed: false, reason: `gdpr: no consent for TCF purpose ${missing.join(', ')}` };
    if (!acConsentedIds(addtlConsent).includes(META_ATP_ID)) return { allowed: false, reason: 'gdpr: no consent for Meta (ad partner 89)' };
    return { allowed: true, reason: 'gdpr: consent given' };
  }
  // Outside GDPR regions UMP reports NOT_REQUIRED (or OBTAINED for another regulation's message).
  if (umpStatus === 'NOT_REQUIRED' || umpStatus === 'OBTAINED') return { allowed: true, reason: `consent ${umpStatus.toLowerCase()}` };
  // REQUIRED (the form was not completed), UNKNOWN or a failed check (offline, no answer): the
  // region is not known, so treat the player as one whose consent is required and not given.
  return { allowed: false, reason: `consent status ${umpStatus ?? 'unavailable'}` };
}
