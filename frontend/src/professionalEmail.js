export const TEST_PROFESSIONAL_EMAIL = "wbpai25@gmail.com";

const PERSONAL_EMAIL_DOMAINS = new Set([
  "aol.com", "btinternet.com", "gmail.com", "gmx.com", "gmx.co.uk",
  "googlemail.com", "hotmail.com", "hotmail.co.uk", "icloud.com",
  "live.com", "live.co.uk", "mail.com", "me.com", "msn.com",
  "outlook.com", "outlook.co.uk", "pm.me", "proton.me",
  "protonmail.com", "sky.com", "talktalk.net", "tuta.com",
  "tutanota.com", "virginmedia.com", "yahoo.com", "yahoo.co.uk",
  "ymail.com",
]);

export const isProfessionalEmailAllowed = (email) => {
  const normalized = (email || "").trim().toLowerCase();
  if (normalized === TEST_PROFESSIONAL_EMAIL) return true;
  const parts = normalized.split("@");
  if (parts.length !== 2 || !parts[0] || !parts[1] || !parts[1].includes(".")) return false;
  return !PERSONAL_EMAIL_DOMAINS.has(parts[1]);
};
