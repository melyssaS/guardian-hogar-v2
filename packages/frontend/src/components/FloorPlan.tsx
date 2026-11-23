import { FLOOR_HEIGHT, FLOOR_WIDTH } from '@home-guardian/domain';
import type { MouseEvent } from 'react';
import type { Point, RobotSnapshot, Zone } from '../types';

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

/** Colores del robot en el prototipo: activo (azul) y detenido (rojo). */
const ROBOT_COLOR = { active: '#3176d2', stopped: '#bd4954' } as const;
const DESTINATION_COLOR = '#316cde';

interface FloorPlanProps {
  zones: Zone[];
  /** Estado y posición del robot según la API (spec 003, RF-04.4). */
  robot?: RobotSnapshot | null;
  /** Destino elegido, para marcarlo en el plano. */
  destination?: Point | null;
  /** Si se indica, un clic en el plano emite ese punto como destino (RF-01.1). */
  onSelectPoint?: (p: Point) => void;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Convierte coordenadas de viewport a unidades del plano, redondeadas a enteros para que
 * coincidan con lo que se puede escribir a mano (CA-03.7). Respeta `xMinYMin meet`: el plano
 * se escala de forma uniforme y queda anclado arriba a la izquierda. Puede devolver puntos
 * fuera del plano; la validación de límites la hacen la UI y el backend (RF-01.5).
 */
export function clientToFloor(clientX: number, clientY: number, box: Box): Point | null {
  const scale = Math.min(box.width / FLOOR_WIDTH, box.height / FLOOR_HEIGHT);
  if (!(scale > 0)) return null;
  return {
    x: Math.round((clientX - box.left) / scale),
    y: Math.round((clientY - box.top) / scale),
  };
}

const STATE_LABEL: Record<RobotSnapshot['state'], string> = {
  IDLE: 'Robot · IDLE',
  MOVING: 'Robot · MOVING',
  SAFE_STOP: 'Robot · SAFE_STOP',
};

/** Robot con el aspecto del prototipo. La posición se anima con CSS (`.robot-marker`). */
function RobotMarker({ robot }: { robot: RobotSnapshot }) {
  const stopped = robot.state === 'SAFE_STOP';
  const c = stopped ? ROBOT_COLOR.stopped : ROBOT_COLOR.active;
  const { x, y } = robot.position;
  return (
    <g
      data-testid="robot"
      data-state={robot.state}
      data-x={x}
      data-y={y}
      className="robot-marker"
      style={{ transform: `translate(${x}px, ${y}px)` }}
      pointerEvents="none"
    >
      <circle r={28} fill={c} opacity={0.15} />
      <circle r={19} fill={c} stroke="white" strokeWidth={3} />
      <circle r={5} fill="white" />
      <rect x={-58} y={-54} width={116} height={22} rx={7} fill="#18314a" />
      <text
        textAnchor="middle"
        y={-39}
        fontFamily="Arial,sans-serif"
        fontSize={10}
        fontWeight={800}
        fill="white"
      >
        {STATE_LABEL[robot.state]}
      </text>
    </g>
  );
}

function DestinationMarker({ point, from }: { point: Point; from?: Point }) {
  return (
    <g data-testid="destination-marker" pointerEvents="none">
      {from && (
        <line
          x1={from.x}
          y1={from.y}
          x2={point.x}
          y2={point.y}
          stroke={DESTINATION_COLOR}
          strokeWidth={2}
          strokeDasharray="6 6"
          opacity={0.6}
        />
      )}
      <circle
        cx={point.x}
        cy={point.y}
        r={11}
        fill="none"
        stroke={DESTINATION_COLOR}
        strokeWidth={2}
      />
      <line
        x1={point.x - 16}
        y1={point.y}
        x2={point.x + 16}
        y2={point.y}
        stroke={DESTINATION_COLOR}
        strokeWidth={2}
      />
      <line
        x1={point.x}
        y1={point.y - 16}
        x2={point.x}
        y2={point.y + 16}
        stroke={DESTINATION_COLOR}
        strokeWidth={2}
      />
    </g>
  );
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
 * Spec 003: opcionalmente pinta el robot y el destino, y captura el destino por clic.
 */
export function FloorPlan({ zones, robot, destination, onSelectPoint }: FloorPlanProps) {
  const xs = Array.from({ length: FLOOR_WIDTH / GRID_STEP + 1 }, (_, i) => i * GRID_STEP);
  const ys = Array.from({ length: FLOOR_HEIGHT / GRID_STEP + 1 }, (_, i) => i * GRID_STEP);
  const restricted = zones.filter((z) => z.active).length;
  // Las restringidas se pintan al final para que su borde quede por encima.
  const ordered = [...zones.filter((z) => !z.active), ...zones.filter((z) => z.active)];

  const handleClick = onSelectPoint
    ? (e: MouseEvent<SVGSVGElement>) => {
        const p = clientToFloor(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
        if (p) onSelectPoint(p);
      }
    : undefined;

  return (
    <svg
      data-testid="floor-plan"
      role="img"
      aria-label={`Plano ${FLOOR_WIDTH} × ${FLOOR_HEIGHT}: ${restricted} zona${restricted === 1 ? '' : 's'} restringida${restricted === 1 ? '' : 's'} de ${zones.length}`}
      viewBox={`0 0 ${FLOOR_WIDTH} ${FLOOR_HEIGHT}`}
      preserveAspectRatio="xMinYMin meet"
      onClick={handleClick}
      style={onSelectPoint ? { cursor: 'crosshair' } : undefined}
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
      {destination && <DestinationMarker point={destination} from={robot?.position} />}
      {robot && <RobotMarker robot={robot} />}
    </svg>
  );
}
