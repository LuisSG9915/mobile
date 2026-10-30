/**
 * XMLHttpRequest falso para tests de subida de partes: sin red, con progreso
 * sintético y respuesta programable. `installFakeXhr` lo pone en `globalThis` y
 * devuelve las peticiones vistas para poder afirmar sobre el body (p. ej. que la
 * parte va como ArrayBuffer y no como string base64).
 */

export type FakeXhrPlan = {
  status: number;
  /** ETag de respuesta; `null` simula que R2 no lo devolvió. */
  etag?: string | null;
  fail?: "error" | "abort" | "timeout";
  /** Deja la petición en vuelo (solo emite progreso) para probar abort/timeout. */
  hold?: boolean;
};

export type FakeXhrRequest = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  aborted: boolean;
};

type PlanArg = FakeXhrPlan | ((request: FakeXhrRequest) => FakeXhrPlan);

export function installFakeXhr(planArg: PlanArg): {
  requests: FakeXhrRequest[];
  restore: () => void;
} {
  const requests: FakeXhrRequest[] = [];
  const globals = globalThis as { XMLHttpRequest?: unknown };
  const original = globals.XMLHttpRequest;

  class FakeXMLHttpRequest {
    status = 0;
    readyState = 0;
    upload: { onprogress: ((event: { loaded: number; total: number }) => void) | null } = {
      onprogress: null,
    };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    private request: FakeXhrRequest = {
      method: "",
      url: "",
      headers: {},
      body: null,
      aborted: false,
    };
    private resolved: FakeXhrPlan | null = null;

    constructor() {
      requests.push(this.request);
    }

    open(method: string, url: string) {
      this.request.method = method;
      this.request.url = url;
      this.readyState = 1;
    }

    setRequestHeader(name: string, value: string) {
      this.request.headers[name.toLowerCase()] = value;
    }

    getResponseHeader(name: string) {
      if (name.toLowerCase() !== "etag") return null;
      return this.resolved?.etag ?? null;
    }

    send(body: unknown) {
      this.request.body = body;
      this.resolved = typeof planArg === "function" ? planArg(this.request) : planArg;
      const plan = this.resolved;
      queueMicrotask(() => {
        if (this.request.aborted) return;
        const size =
          body && typeof body === "object" && "byteLength" in body
            ? Number((body as ArrayBuffer).byteLength)
            : 0;
        this.upload.onprogress?.({ loaded: size, total: size });
        if (plan.hold) return;
        if (plan.fail === "error") {
          this.onerror?.();
          return;
        }
        if (plan.fail === "abort") {
          this.onabort?.();
          return;
        }
        if (plan.fail === "timeout") {
          this.ontimeout?.();
          return;
        }
        this.status = plan.status;
        this.readyState = 4;
        this.onload?.();
      });
    }

    abort() {
      this.request.aborted = true;
      this.onabort?.();
    }
  }

  globals.XMLHttpRequest = FakeXMLHttpRequest;
  return {
    requests,
    restore: () => {
      globals.XMLHttpRequest = original;
    },
  };
}
