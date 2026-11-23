import type { Robot } from '../types';
import { QUALITY_PILL, STATE_PILL, TYPE_LABEL } from './pills';

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

interface RobotCardProps {
  robot: Robot;
}

/** Tarjeta de un robot del catálogo: nombre, tipo, estado, calidad y posición (RF-07.8). */
export function RobotCard({ robot }: RobotCardProps) {
  return (
    <div className="card robot-card" data-testid={`robot-card-${robot.id}`}>
      <div className="section-heading">
        <div className="robot-icon">{robot.type === 'GUARD' ? '♢' : '◉'}</div>
        <span className={STATE_PILL[robot.state]}>{robot.state}</span>
      </div>
      <h3>{robot.name}</h3>
      <p>
        <span>{TYPE_LABEL[robot.type]}</span> · #{robot.id}
      </p>
      <div className="section-heading" style={{ marginBottom: 0 }}>
        <span className={QUALITY_PILL[robot.positionQuality]}>{robot.positionQuality}</span>
        <b className="small">
          ({fmt(robot.position.x)}, {fmt(robot.position.y)})
        </b>
      </div>
      <a className="card-link" href={`#/supervision?robot=${robot.id}`}>
        Supervisar →
      </a>
    </div>
  );
}
