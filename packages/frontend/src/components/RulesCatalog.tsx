import { RULES } from '@home-guardian/domain';

/**
 * Tarjeta «Catálogo de reglas» (HU-02, RF-06.3): solo lectura, generada a partir de `RULES`
 * del dominio. No evalúa reglas ni hace llamadas HTTP (constitución art. III).
 */
export function RulesCatalog() {
  return (
    <section className="card pad">
      <div className="section-heading">
        <div>
          <h2 className="card-title">Catálogo de reglas</h2>
          <p className="card-sub">Reglas que aplica el vigilante</p>
        </div>
        <span className="tag green">MADA · CONTROL</span>
      </div>

      {RULES.map((rule) => (
        <div
          key={rule.id}
          className="rulecard"
          data-testid={`rule-${rule.id}`}
          style={{ marginBottom: 10 }}
        >
          <div className="rule-id">{rule.id} · DENTRO DEL MVP</div>
          <strong>{rule.title}</strong>
          <p>{rule.description}</p>
          <div className="pills" style={{ marginTop: 9 }}>
            {rule.stories.map((story) => (
              <span key={story} className="pill">
                {story}
              </span>
            ))}
          </div>
        </div>
      ))}

      <div className="rulecard">
        <div className="rule-id">FUERA DEL MVP</div>
        <strong>Distancia a personas y frenado físico</strong>
        <p>
          Se consideran riesgos del dominio, pero requieren sensores y hardware no presentes en este
          taller.
        </p>
      </div>
    </section>
  );
}
