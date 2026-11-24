import { describe, expect, it, vi } from "vitest";

vi.mock("../api/client", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

import { ApiError } from "../api/client";
import { t } from "../i18n/es";
import { toUserMessage } from "./user-message";

describe("toUserMessage", () => {
  it("usa el mensaje del servidor en ApiError", () => {
    expect(toUserMessage(new ApiError(413, "quota", "Cuota llena"))).toBe("Cuota llena");
  });
  it("traduce errores de red en inglés", () => {
    expect(toUserMessage(new Error("Network request failed"))).toBe(t.common.networkError);
  });
  it("respeta mensajes en español", () => {
    expect(toUserMessage(new Error("La solicitud tardó demasiado."))).toBe(
      "La solicitud tardó demasiado.",
    );
  });
  it("cae al genérico con errores técnicos", () => {
    expect(toUserMessage(new Error("TypeError: undefined is not a function"))).toBe(
      t.auth.genericError,
    );
  });
});
