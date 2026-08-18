import { createYodaManClient as createSharedClient } from '../../../../shared/yodamanClient';

export function createYodaManClient(runtimeUrl, pairingToken) {
  return createSharedClient(runtimeUrl, { pairingToken });
}
