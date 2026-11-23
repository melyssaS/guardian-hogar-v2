import type { Request, Response } from 'express';
import type { IncidentRepository } from '../repositories/incidentRepository.js';

/** Solo recibe y responde; lee del repositorio append-only (SOLID-S, R5.1). */
export function createIncidentController(incidents: IncidentRepository) {
  return {
    list(_req: Request, res: Response) {
      res.json(incidents.findAll());
    },
  };
}
