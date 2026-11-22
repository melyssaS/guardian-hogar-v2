/** Zona restringida persistida (HU-02, RF-02). */
export interface Zone {
    id: number;
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
    active: boolean;
    /** ISO-8601 */
    createdAt: string;
}
/** Datos de entrada para crear o modificar una zona. */
export type ZoneInput = Omit<Zone, 'id' | 'createdAt'>;
/** Rectángulo mínimo para la geometría: solo posición y tamaño. */
export type ZoneRect = Pick<Zone, 'x' | 'y' | 'width' | 'height'>;
