import webpush from 'web-push';

/** Web push (VAPID). Each tenant has its own key pair (control plane, encrypted). */
export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string | null;
  tag?: string;
}

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export type PushResult = 'sent' | 'gone';

export interface PushSender {
  send(
    target: PushTarget,
    payload: PushPayload,
    vapid: VapidKeys,
    subject: string,
  ): Promise<PushResult>;
}

export const generateVapidKeys = (): VapidKeys => webpush.generateVAPIDKeys();

export function webPushSender(): PushSender {
  return {
    async send(target, payload, vapid, subject) {
      try {
        await webpush.sendNotification(
          { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
          JSON.stringify(payload),
          { vapidDetails: { subject, ...vapid }, TTL: 60 * 60 * 24 },
        );
        return 'sent';
      } catch (err) {
        // 404/410: the browser dropped the subscription — the caller deletes it.
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) return 'gone';
        throw err;
      }
    },
  };
}

export function memoryPush(): PushSender & {
  sent: { target: PushTarget; payload: PushPayload }[];
  gone: Set<string>;
} {
  const sent: { target: PushTarget; payload: PushPayload }[] = [];
  const gone = new Set<string>();
  return {
    sent,
    gone,
    async send(target, payload) {
      if (gone.has(target.endpoint)) return 'gone';
      sent.push({ target, payload });
      return 'sent';
    },
  };
}
