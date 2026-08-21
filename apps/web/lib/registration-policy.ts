import { timingSafeEqual } from "node:crypto";

export class RegistrationPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistrationPolicyError";
  }
}

function tokensMatch(expected: string, provided: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);

  if (expectedBytes.length !== providedBytes.length) return false;
  return timingSafeEqual(expectedBytes, providedBytes);
}

export function assertRegistrationAllowed(input: {
  registrationEnabled: boolean;
  userCount: number;
  configuredSetupToken?: string;
  providedSetupToken?: string;
}): void {
  if (!input.registrationEnabled) {
    throw new RegistrationPolicyError("Registration is closed on this Relay instance.");
  }

  if (input.userCount > 0) return;

  if (!input.configuredSetupToken || input.configuredSetupToken.length < 24) {
    throw new RegistrationPolicyError(
      "Owner setup is unavailable. Configure RELAY_SETUP_TOKEN with at least 24 characters.",
    );
  }

  if (!input.providedSetupToken || !tokensMatch(input.configuredSetupToken, input.providedSetupToken)) {
    throw new RegistrationPolicyError("The owner setup token is invalid.");
  }
}
