export type { Zone, ZoneInput, ZoneRect } from './models/zone.js';
export { classifyZoneUpdate } from './models/zoneChange.js';
export type { ZoneChange, ZoneChangeAction } from './models/zoneChange.js';
export type {
  RobotStateName,
  Decision,
  RobotSnapshot,
  MoveRequest,
  MoveResult,
  RobotType,
  Robot,
  RobotInput,
  MoveCommand,
  SessionInfo,
  LastRequest,
} from './models/robot.js';
export type {
  PositionQuality,
  DecisionCode,
  IncidentCode,
  GuardianInput,
  GuardianDecision,
  PositionReading,
  RobotId,
  TransitionCause,
  RecoveryRejectionCause,
  RobotStatus,
  RecoverResponse,
  Incident,
  IncidentDetail,
  RejectionCode,
  ServiceResult,
  MoveResponse,
  PositionResponse,
} from './models/guardian.js';
export { pointSchema, moveRequestSchema } from './schemas/simulation.schema.js';
export type { MoveRequestBody } from './schemas/simulation.schema.js';
export type { Point, Segment, AABB } from './geometry/types.js';
export {
  FLOOR_WIDTH,
  FLOOR_HEIGHT,
  ROBOT_RADIUS,
  SAFETY_MARGIN,
  COLLISION_PAD,
  envNumber,
} from './geometry/constants.js';
export { expandZone, pointInAABB } from './geometry/aabb.js';
export { segmentIntersectsAABB, isCollision } from './geometry/collision.js';
export type { CollisionType, CollisionResult } from './geometry/collision.js';
export {
  zoneInputSchema,
  createZoneSchema,
  updateZoneSchema,
  listZoneQuerySchema,
  zoneIdParamSchema,
} from './schemas/zone.schema.js';
export type {
  CreateZoneBody,
  UpdateZoneBody,
  ListZoneQuery,
  ZoneActiveFilter,
} from './schemas/zone.schema.js';
export { moveSchema, positionSchema, robotIdParamSchema } from './schemas/robot.schema.js';
export { incidentIdParamSchema, incidentListQuerySchema } from './schemas/incident.schema.js';
export type { IncidentListQuery } from './schemas/incident.schema.js';
export type { MoveBody, PositionBody } from './schemas/robot.schema.js';
export { RULES, ruleForDecision } from './rules/catalog.js';
export type { Rule, RuleId } from './rules/catalog.js';
export { robotInputSchema } from './schemas/robotCatalog.schema.js';
export { moveCommandSchema } from './schemas/moveCommand.schema.js';
