import { isProfessionalEmailAllowed } from "./professionalEmail";

test("requires a professional domain except for the dedicated test address", () => {
  expect(isProfessionalEmailAllowed("person@practice.co.uk")).toBe(true);
  expect(isProfessionalEmailAllowed("person@gmail.com")).toBe(false);
  expect(isProfessionalEmailAllowed("person@outlook.co.uk")).toBe(false);
  expect(isProfessionalEmailAllowed("WBPai25@Gmail.com ")).toBe(true);
  expect(isProfessionalEmailAllowed("other@gmail.com")).toBe(false);
  expect(isProfessionalEmailAllowed("not-an-email")).toBe(false);
});
