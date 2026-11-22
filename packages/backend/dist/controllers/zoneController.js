/** Solo recibe y responde; delega toda la lógica al servicio (SOLID-S). */
export function createZoneController(service) {
    return {
        list(req, res) {
            const query = req.query;
            res.json(service.list(query.active));
        },
        get(req, res) {
            res.json(service.get(req.params.id));
        },
        create(req, res) {
            res.status(201).json(service.create(req.body));
        },
        update(req, res) {
            res.json(service.update(req.params.id, req.body));
        },
        remove(req, res) {
            service.remove(req.params.id);
            res.status(204).end();
        },
    };
}
