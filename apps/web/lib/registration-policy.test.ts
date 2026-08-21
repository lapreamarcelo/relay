import assert from "node:assert/strict";
import test from "node:test";

import { assertRegistrationAllowed, RegistrationPolicyError } from "./registration-policy.ts";

const token = "relay-owner-setup-token-123456789";

test("closed registration rejects every signup", () => {
  assert.throws(
    () => assertRegistrationAllowed({ registrationEnabled: false, userCount: 0, configuredSetupToken: token, providedSetupToken: token }),
    RegistrationPolicyError,
  );
});

test("the first account requires the configured setup token", () => {
  assert.throws(
    () => assertRegistrationAllowed({ registrationEnabled: true, userCount: 0, configuredSetupToken: token }),
    /setup token is invalid/i,
  );
  assert.throws(
    () => assertRegistrationAllowed({ registrationEnabled: true, userCount: 0, configuredSetupToken: token, providedSetupToken: `${token}x` }),
    /setup token is invalid/i,
  );
  assert.doesNotThrow(
    () => assertRegistrationAllowed({ registrationEnabled: true, userCount: 0, configuredSetupToken: token, providedSetupToken: token }),
  );
});

test("later accounts do not need the owner setup token", () => {
  assert.doesNotThrow(() => assertRegistrationAllowed({ registrationEnabled: true, userCount: 1 }));
});
