import {
  COLLISION_PAD,
  isCollision,
  type CollisionType,
  type MoveResult,
  type Point,
  type RobotStateName,
  type Zone,
} from '@home-guardian/domain';

export interface DecideMovementInput {
  state: RobotStateName;
  origin: Point;
  destination: Point;
  activeZones: Zone[];
  /** Expansión r + m por lado; por defecto COLLISION_PAD (spec 001, DD-001). */
  pad?: number;
}

const REASON_BY_COLLISION: Record<CollisionType, (zone: string) => string> = {
  ORIGIN_IN_RESTRICTED_ZONE: (zone) => `Origin is inside restricted zone: ${zone}`,
  RESTRICTED_ZONE_VIOLATION: (zone) => `Destination is inside restricted zone: ${zone}`,
  TRAJECTORY_CROSSES_ZONE: (zone) => `Trajectory crosses restricted zone: ${zone}`,
};

/**
 * Vigilante de movimiento (spec 003 §2 del design; RF-02.2, RF-03; DD-104).
 * Regla pura y determinista (RNF-06): la salida depende solo de las entradas.
 *
 * 1. SAFE_STOP absorbe: toda solicitud → DENIED_SAFE_STOP (SAFE_STOP_ACTIVE), sin cambios.
 * 2. Fallo seguro: si el segmento origen→destino colisiona con alguna zona activa
 *    → PREVENTIVE_STOP, SAFE_STOP, el robot permanece en el origen (primera colisión).
 * 3. En otro caso → ALLOW, MOVING, el robot pasa al destino.
 *
 * Los límites del plano se validan antes, en el servicio (DD-107).
 */
export function decideMovement({
  state,
  origin,
  destination,
  activeZones,
  pad = COLLISION_PAD,
}: DecideMovementInput): MoveResult {
  if (state === 'SAFE_STOP') {
    return {
      decision: 'DENIED_SAFE_STOP',
      code: 'SAFE_STOP_ACTIVE',
      state: 'SAFE_STOP',
      position: { ...origin },
      reason: 'Robot is in SAFE_STOP; movement denied',
    };
  }

  const segment = { from: origin, to: destination };
  for (const zone of activeZones) {
    const { type } = isCollision(zone, segment, pad);
    if (type) {
      return {
        decision: 'PREVENTIVE_STOP',
        state: 'SAFE_STOP',
        position: { ...origin },
        collisionType: type,
        zoneName: zone.name,
        reason: REASON_BY_COLLISION[type](zone.name),
      };
    }
  }

  return {
    decision: 'ALLOW',
    state: 'MOVING',
    position: { ...destination },
    reason: 'Destination and trajectory are clear',
  };
}
