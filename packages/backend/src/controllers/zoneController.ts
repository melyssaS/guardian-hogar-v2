import type { CreateZoneBody, ListZoneQuery, UpdateZoneBody } from '@home-guardian/domain';
import type { Request, Response } from 'express';
import type { ZoneService } from '../services/zoneService.js';

type IdParams = { id: number };

/** Solo recibe y responde; delega toda la lógica al servicio (SOLID-S). */
export function createZoneController(service: ZoneService) {
  return {
    list(req: Request, res: Response) {
      const query = req.query as ListZoneQuery;
      res.json(service.list(query.active));
    },
    get(req: Request, res: Response) {
      res.json(service.get((req.params as unknown as IdParams).id));
    },
    create(req: Request, res: Response) {
      res.status(201).json(service.create(req.body as CreateZoneBody));
    },
    listChanges(_req: Request, res: Response) {
      res.json(service.listChanges());
    },
    update(req: Request, res: Response) {
      res.json(service.update((req.params as unknown as IdParams).id, req.body as UpdateZoneBody));
    },
    remove(req: Request, res: Response) {
      service.remove((req.params as unknown as IdParams).id);
      res.status(204).end();
    },
  };
}
