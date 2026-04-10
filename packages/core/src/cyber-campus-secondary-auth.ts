export interface CyberCampusSecondaryAuthMethod {
  way: number;
  param: string;
  target: string;
  label: string;
  requiresCode: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function asDeviceList(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value
    .map(asRecord)
    .filter((item): item is Record<string, unknown> => item !== null);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseCyberCampusSecondaryAuthMethods(data: Record<string, unknown>): CyberCampusSecondaryAuthMethod[] {
  const methods: CyberCampusSecondaryAuthMethod[] = [];
  const deviceList = asDeviceList(data.USER_DEVICE_LIST);

  if (readString(data.IS_ENABLE_APP) === "Y") {
    for (const device of deviceList) {
      const deviceId = readString(device.DEVICE_ID);
      const deviceLabel = readString(device.DEVICE_MODEL);
      if (!deviceId || !deviceLabel) continue;
      methods.push({
        way: 1,
        param: deviceId,
        target: deviceLabel,
        label: `HelloLMS 앱코드 인증: ${deviceLabel}`,
        requiresCode: true,
      });
    }
  }

  if (readString(data.IS_ENABLE_APP2) === "Y") {
    for (const device of deviceList) {
      const deviceId = readString(device.DEVICE_ID);
      const deviceLabel = readString(device.DEVICE_MODEL);
      if (!deviceId || !deviceLabel) continue;
      methods.push({
        way: 5,
        param: deviceId,
        target: deviceLabel,
        label: `HelloLMS 앱확인: ${deviceLabel}`,
        requiresCode: false,
      });
    }
  }

  const userEmail = readString(data.USER_EMAIL);
  if (readString(data.IS_ENABLE_EMAIL) === "Y" && userEmail) {
    methods.push({
      way: 2,
      param: userEmail,
      target: userEmail,
      label: `이메일 인증: ${userEmail}`,
      requiresCode: true,
    });
  }

  const userPhone = readString(data.USER_PHONE);
  if (readString(data.IS_ENABLE_SMS) === "Y" && userPhone) {
    methods.push({
      way: 3,
      param: userPhone,
      target: userPhone,
      label: `SMS 인증: ${userPhone}`,
      requiresCode: true,
    });
  }

  const userId = readString(data.USER_ID);
  const userName = readString(data.USER_NAME) || "사용자";
  if (readString(data.IS_ENABLE_PUSH) === "Y" && userId) {
    methods.push({
      way: 4,
      param: userId,
      target: userName,
      label: `푸시 인증: ${userName}`,
      requiresCode: true,
    });
  }

  return methods;
}
