interface TelemetryPanelProps {
  /** Cuerpo enviado a la API en la última solicitud, sin transformar. */
  request: unknown;
  /** Cuerpo devuelto por la API para esa solicitud, sin transformar. */
  response: unknown;
}

/**
 * Telemetría (RF-08.7, CA-03.24): el JSON de la última solicitud enviada y de la respuesta
 * recibida. Solo serializa lo que recibe; no añade, quita ni inventa campos (art. XV).
 */
export function TelemetryPanel({ request, response }: TelemetryPanelProps) {
  const hasExchange = request !== null && response !== null;
  return (
    <section className="card pad" aria-label="Telemetría">
      <div className="section-heading">
        <div>
          <h2 className="card-title">Telemetría</h2>
          <p className="card-sub">Solicitud enviada y respuesta recibida</p>
        </div>
        <span className="tag">JSON</span>
      </div>
      {hasExchange ? (
        <>
          <label className="label">Solicitud</label>
          <pre className="telemetry" data-testid="telemetry-request">
            {JSON.stringify(request, null, 2)}
          </pre>
          <label className="label" style={{ marginTop: 12 }}>
            Respuesta
          </label>
          <pre className="telemetry" data-testid="telemetry-response">
            {JSON.stringify(response, null, 2)}
          </pre>
        </>
      ) : (
        <div className="empty">Esperando una solicitud…</div>
      )}
    </section>
  );
}
