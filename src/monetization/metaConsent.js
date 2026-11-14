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
//   gppSid           IABGPP_GppSID: GPP section ids in force, '_'-separated (e.g. '7'), from the
//                    UMP "US states regulations" message
//   gppString        IABGPP_HDR_GppString: the full GPP string, e.g. 'DBABL~BVQqAAAAAg'
//                    (UMP writes only these two GPP keys, so the string is decoded here)
//
// Meta is not an IAB TCF vendor; in Google's consent tools it is ad tech provider 89. So where
// GDPR applies Meta may run only when the player consented to Meta itself (ATP 89 in the
// consented part of the Additional Consent string) and to the two TCF purposes this use needs:
//   1  Store and/or access information on a device (the advertising ID, the SDK's own storage)
//   7  Measure advertising performance (install and app-open attribution for Meta ads)
// Anything missing, unreadable or still pending counts as "no".
//
// Where the US states message applies (a US section in IABGPP_GppSID), Meta may run only when
// the US National (usnat, section 7) core says the player did NOT opt out of the sale of
// personal information, of its sharing, and of targeted advertising (value 2 for all three),
// and Global Privacy Control is not set. An opt-out (1), no recorded choice (0), a section this
// code cannot read (another US section, a newer usnat version) or a missing / broken string
// keeps Meta off.

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

// ---- GPP (IAB Global Privacy Platform) decoding, just what the US opt-out check needs ----

export const GPP_USNAT_SECTION = 7;
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// base64url text → '0'/'1' string (6 bits per character); null if a character is invalid.
function toBits(text) {
  if (typeof text !== 'string' || !text) return null;
  let bits = '';
  for (const ch of text) {
    const v = B64URL.indexOf(ch);
    if (v < 0) return null;
    bits += v.toString(2).padStart(6, '0');
  }
  return bits;
}

function bitReader(bits) {
  let pos = 0;
  return {
    int(n) {
      if (pos + n > bits.length) throw new Error('gpp: out of bits');
      const v = parseInt(bits.slice(pos, pos + n), 2);
      pos += n;
      return v;
    },
    // Fibonacci-coded integer: bits weighted 1, 2, 3, 5, 8…, terminated by '11'.
    fib() {
      const fibs = [1, 2];
      let value = 0;
      let prev = '0';
      for (let i = 0; ; i++) {
        if (pos >= bits.length) throw new Error('gpp: out of bits');
        const b = bits[pos++];
        if (b === '1' && prev === '1') return value;
        if (i >= fibs.length) fibs.push(fibs[i - 1] + fibs[i - 2]);
        if (b === '1') value += fibs[i];
        prev = b;
      }
    },
  };
}

// GPP header (first '~' part): { type, version, sectionIds }, or null if unreadable.
export function decodeGppHeader(header) {
  const bits = toBits(header);
  if (!bits) return null;
  try {
    const r = bitReader(bits);
    const type = r.int(6);
    const version = r.int(6);
    if (type !== 3) return null;
    const count = r.int(12);
    const sectionIds = [];
    let last = 0;
    for (let i = 0; i < count; i++) {
      const group = r.int(1) === 1;
      const start = last + r.fib();
      if (group) {
        const end = start + r.fib();
        for (let id = start; id <= end; id++) sectionIds.push(id);
        last = end;
      } else {
        sectionIds.push(start);
        last = start;
      }
    }
    return { type, version, sectionIds };
  } catch {
    return null;
  }
}

// US National section (v1 and v2 share this layout up to the fields read here), plus its GPC
// subsection. Values: 0 not applicable / no notice, 1 opted out, 2 did not opt out.
export function decodeUsnat(section) {
  if (typeof section !== 'string' || !section) return null;
  const [core, ...subsections] = section.split('.');
  const bits = toBits(core);
  if (!bits) return null;
  try {
    const r = bitReader(bits);
    const version = r.int(6);
    if (version !== 1 && version !== 2) return null; // a layout this code does not know
    for (let i = 0; i < 6; i++) r.int(2); // the six notice fields
    const saleOptOut = r.int(2);
    const sharingOptOut = r.int(2);
    const targetedAdvertisingOptOut = r.int(2);
    let gpc = false;
    for (const sub of subsections) {
      const sb = toBits(sub);
      if (!sb) return null;
      const sr = bitReader(sb);
      if (sr.int(2) === 1 && sr.int(1) === 1) gpc = true;
    }
    return { version, saleOptOut, sharingOptOut, targetedAdvertisingOptOut, gpc };
  } catch {
    return null;
  }
}

// GPP section ids in force from IABGPP_GppSID ('7', '2_7'; '-1' or '' = none).
export function gppSectionsInForce(gppSid) {
  if (gppSid === null || gppSid === undefined) return [];
  return String(gppSid)
    .split('_')
    .map((v) => Number(v.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

// US privacy sections: 6 (old US Privacy string), 7 (usnat) and every state section after it.
const isUsSection = (id) => id === 6 || id >= GPP_USNAT_SECTION;

// null when no US section is in force; otherwise { allowed, reason } for the US opt-out.
export function decideUsOptOut({ gppSid, gppString } = {}) {
  const us = gppSectionsInForce(gppSid).filter(isUsSection);
  if (!us.length) return null;
  if (us.some((id) => id !== GPP_USNAT_SECTION)) return { allowed: false, reason: `us: unreadable GPP section ${us.join(', ')}` };
  if (typeof gppString !== 'string') return { allowed: false, reason: 'us: no GPP string' };
  const [headerPart, ...sections] = gppString.split('~');
  const header = decodeGppHeader(headerPart);
  const index = header ? header.sectionIds.indexOf(GPP_USNAT_SECTION) : -1;
  const usnat = index >= 0 ? decodeUsnat(sections[index]) : null;
  if (!usnat) return { allowed: false, reason: 'us: unreadable GPP string' };
  if (usnat.gpc) return { allowed: false, reason: 'us: Global Privacy Control' };
  const { saleOptOut, sharingOptOut, targetedAdvertisingOptOut } = usnat;
  if ([saleOptOut, sharingOptOut, targetedAdvertisingOptOut].some((v) => v === 1)) return { allowed: false, reason: 'us: opted out' };
  if (saleOptOut === 2 && sharingOptOut === 2 && targetedAdvertisingOptOut === 2) return { allowed: true, reason: 'us: did not opt out' };
  return { allowed: false, reason: 'us: no choice recorded' };
}

// Returns { allowed, reason }. `allowed` true means: start the Meta SDK with automatic app
// events and advertiser ID collection on. False means Meta must receive nothing.
export function decideMetaMeasurement({ umpStatus, gdprApplies, purposeConsents, addtlConsent, gppSid, gppString } = {}) {
  if (normalizeGdprApplies(gdprApplies) === 1) {
    // EEA / UK / Switzerland: the player's own choices in the consent message decide.
    const missing = META_TCF_PURPOSES.filter((p) => !hasPurposeConsent(purposeConsents, p));
    if (missing.length) return { allowed: false, reason: `gdpr: no consent for TCF purpose ${missing.join(', ')}` };
    if (!acConsentedIds(addtlConsent).includes(META_ATP_ID)) return { allowed: false, reason: 'gdpr: no consent for Meta (ad partner 89)' };
    return { allowed: true, reason: 'gdpr: consent given' };
  }
  // Outside GDPR regions UMP reports NOT_REQUIRED, or OBTAINED once the US states message ran.
  if (umpStatus === 'NOT_REQUIRED' || umpStatus === 'OBTAINED') {
    // US states message areas: the player's opt-out choices decide.
    const us = decideUsOptOut({ gppSid, gppString });
    if (us) return us;
    // OBTAINED outside GDPR means a consent message did run, and the only other message this
    // game has is the US states one: without a readable US section its choice is unknown.
    if (umpStatus === 'OBTAINED') return { allowed: false, reason: 'us: message ran but no GPP section' };
    return { allowed: true, reason: 'consent not_required' };
  }
  // REQUIRED (the form was not completed), UNKNOWN or a failed check (offline, no answer): the
  // region is not known, so treat the player as one whose consent is required and not given.
  return { allowed: false, reason: `consent status ${umpStatus ?? 'unavailable'}` };
}
