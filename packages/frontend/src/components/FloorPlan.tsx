import { FLOOR_HEIGHT, FLOOR_WIDTH } from '@home-guardian/domain';
import type { Zone } from '../types';

export const GRID_STEP = 100;

/** Paleta del prototipo (Guardian_Hogar_Artifact_V2, `mapSVG`). */
const STYLE = {
  restricted: {
    fill: '#fdefee',
    stroke: '#e9aab0',
    badge: '#fae4e3',
    title: '#9e4550',
    caption: '#c1767d',
    captionText: 'ZONA RESTRINGIDA',
  },
  allowed: {
    fill: '#f9fdfb',
    stroke: '#c7e1dc',
    badge: '#eaf4f1',
    title: '#537e73',
    caption: '#94b5ac',
    captionText: 'ÁREA PERMITIDA',
  },
} as const;

interface FloorPlanProps {
  zones: Zone[];
}

function ZoneShape({ zone }: { zone: Zone }) {
  const restricted = zone.active;
  const s = restricted ? STYLE.restricted : STYLE.allowed;
  const badgeWidth = Math.max(0, Math.min(zone.width - 22, zone.name.length * 7 + 56));

  return (
    <g data-testid={`zone-${zone.id}`} data-state={restricted ? 'restricted' : 'allowed'}>
      <rect
        x={zone.x}
        y={zone.y}
        width={zone.width}
        height={zone.height}
        rx={12}
        fill={s.fill}
        stroke={s.stroke}
        strokeWidth={2}
        strokeDasharray={restricted ? '7 5' : undefined}
      />
      <rect x={zone.x + 12} y={zone.y + 11} width={badgeWidth} height={26} rx={7} fill={s.badge} />
      <text
        x={zone.x + 23}
        y={zone.y + 29}
        fontSize={12}
        fontFamily="Arial,sans-serif"
        fontWeight={800}
        fill={s.title}
      >
        {restricted ? `⊘ ${zone.name}` : zone.name}
      </text>
      <text
        x={zone.x + 14}
        y={zone.y + zone.height - 15}
        fontSize={10}
        fontFamily="Arial,sans-serif"
        fill={s.caption}
      >
        {s.captionText}
      </text>
    </g>
  );
}

/**
 * Plano 2D a escala FLOOR_WIDTH × FLOOR_HEIGHT, origen arriba-izquierda (eje Y hacia abajo,
 * igual que SVG) y cuadrícula cada GRID_STEP (CA-01.1). Una zona activa se destaca como
 * restringida (borde rojo discontinuo); una inactiva se dibuja como área permitida (CA-01.2).
 */
export function FloorPlan({ zones }: FloorPlanProps) {
  const xs = Array.from({ length: FLOOR_WIDTH / GRID_STEP + 1 }, (_, i) => i * GRID_STEP);
  const ys = Array.from({ length: FLOOR_HEIGHT / GRID_STEP + 1 }, (_, i) => i * GRID_STEP);
  const restricted = zones.filter((z) => z.active).length;
  // Las restringidas se pintan al final para que su borde quede por encima.
  const ordered = [...zones.filter((z) => !z.active), ...zones.filter((z) => z.active)];

  return (
    <svg
      data-testid="floor-plan"
      role="img"
      aria-label={`Plano ${FLOOR_WIDTH} × ${FLOOR_HEIGHT}: ${restricted} zona${restricted === 1 ? '' : 's'} restringida${restricted === 1 ? '' : 's'} de ${zones.length}`}
      viewBox={`0 0 ${FLOOR_WIDTH} ${FLOOR_HEIGHT}`}
      preserveAspectRatio="xMinYMin meet"
    >
      <rect width={FLOOR_WIDTH} height={FLOOR_HEIGHT} fill="#eef4f7" />
      <g data-testid="grid" stroke="#dde6ec" strokeWidth={1}>
        {xs.map((x) => (
          <line key={`v${x}`} x1={x} y1={0} x2={x} y2={FLOOR_HEIGHT} />
        ))}
        {ys.map((y) => (
          <line key={`h${y}`} x1={0} y1={y} x2={FLOOR_WIDTH} y2={y} />
        ))}
      </g>
      {ordered.map((z) => (
        <ZoneShape key={z.id} zone={z} />
      ))}
    </svg>
  );
}
