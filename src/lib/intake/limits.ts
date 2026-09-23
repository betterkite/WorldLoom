/** Shared input limits for public ingestion and integration endpoints. */
export const MAX_SOURCE_CONTENT_BYTES = 2_000_000;
export const MAX_SOURCE_BINARY_BYTES = 15_000_000;
export const MAX_SOURCE_REQUEST_BYTES = 24_000_000;
export const MAX_URL_RESPONSE_BYTES = 2_000_000;
export const MAX_MANUSCRIPT_REQUEST_BYTES = 4_000_000;
export const MAX_MCP_REQUEST_BYTES = 1_000_000;
export const MAX_JSON_REQUEST_BYTES = 2_000_000;

export function formatBytes(bytes: number): string {
  return bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(1)} MB`
    : `${Math.ceil(bytes / 1_000)} KB`;
}
