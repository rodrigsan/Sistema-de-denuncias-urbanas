-- Migración 002: roles, categorías, subcategorías, unidades y reglas sugeridas.
-- Los nombres/unidades proceden del archivo "Categorias y unidades.txt"
-- proporcionado para el proyecto. Verificar con el municipio antes de producción.
BEGIN;

INSERT INTO roles (code, name, description) VALUES
('MODERATOR', 'Moderador', 'Revisa denuncias, decide validación/rechazo y confirma la unidad responsable.'),
('TECHNICAL_LIAISON', 'Enlace Técnico/Supervisor', 'Atiende denuncias asignadas y registra soluciones.'),
('SUPERADMIN', 'Superadministrador', 'Administra cuentas y roles; no tiene permiso para consultar contenido de denuncias.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO categories (code, name, description, sort_order) VALUES
('VIALIDAD_CALLES', 'Vialidad y Calles', 'Baches, pavimento, señalización, semáforos, aceras y rampas.', 1),
('SERVICIOS_ILUMINACION', 'Servicios Básicos e Iluminación', 'Alumbrado público, fugas de agua y alcantarillado.', 2),
('ESPACIOS_AREAS_VERDES', 'Espacios Públicos y Áreas Verdes', 'Parques, plazas, árboles peligrosos y áreas recreativas.', 3),
('GESTION_AMBIENTAL_ASEO', 'Gestión Ambiental y Aseo Urbano', 'Botaderos clandestinos, recolección y escombros.', 4),
('SEGURIDAD', 'Seguridad', 'Cámaras municipales dañadas y lotes baldíos abandonados.', 5)
ON CONFLICT (code) DO NOTHING;

INSERT INTO subcategories (category_id, code, name, description, sort_order)
SELECT c.id, x.code, x.name, x.description, x.sort_order
FROM (VALUES
 ('VIALIDAD_CALLES','BACHES_PAVIMENTO','Baches / pavimento','Baches, grietas, hundimientos o pavimento dañado.',1),
 ('VIALIDAD_CALLES','SENALIZACION_SEMAFOROS','Señalización / semáforos','Señalización vial, semáforos o pintura vial dañados.',2),
 ('VIALIDAD_CALLES','ACERAS_RAMPAS','Aceras / rampas','Aceras destruidas u obstruidas y rampas dañadas.',3),
 ('SERVICIOS_ILUMINACION','ALUMBRADO_PUBLICO','Alumbrado público','Luminarias, focos o postes de alumbrado público dañados.',1),
 ('SERVICIOS_ILUMINACION','FUGAS_AGUA_ALCANTARILLADO','Fugas de agua / alcantarillado','Fugas, tuberías rotas o problemas de alcantarillado.',2),
 ('ESPACIOS_AREAS_VERDES','PARQUES_PLAZAS','Parques / plazas','Mantenimiento e infraestructura de parques y plazas.',1),
 ('ESPACIOS_AREAS_VERDES','ARBOLES_PODA','Árboles peligrosos / poda','Árboles peligrosos, poda o situaciones que requieran evaluación.',2),
 ('ESPACIOS_AREAS_VERDES','AREAS_RECREATIVAS','Áreas recreativas','Áreas recreativas, canchas o equipamiento recreativo.',3),
 ('GESTION_AMBIENTAL_ASEO','BOTADEROS_CLANDESTINOS','Botaderos clandestinos','Depósitos clandestinos de residuos.',1),
 ('GESTION_AMBIENTAL_ASEO','FALLAS_RECOLECCION','Fallas en la recolección','Fallas en recolección, contenedores o barrido.',2),
 ('GESTION_AMBIENTAL_ASEO','ESCOMBROS_CONSTRUCCION','Escombros de construcción','Escombros abandonados en espacios públicos.',3),
 ('SEGURIDAD','CAMARAS_MUNICIPALES','Cámaras municipales dañadas','Cámaras municipales o equipos de monitoreo dañados.',1),
 ('SEGURIDAD','LOTES_ABANDONADOS','Lotes baldíos abandonados','Lotes abandonados que representen riesgos o requieran intervención.',2)
) AS x(category_code, code, name, description, sort_order)
JOIN categories c ON c.code = x.category_code
ON CONFLICT (code) DO NOTHING;

INSERT INTO municipal_units (code, name, description) VALUES
('OBRAS_PUBLICAS','Dirección de Obras Públicas','Dependiente de la Secretaría de Infraestructura; candidata para avenidas principales/estructurantes.'),
('MOVILIDAD_URBANA','Dirección de Movilidad Urbana','Señalización vial, semáforos y pintura vial.'),
('SUBALCALDIA_DISTRITO','Subalcaldía del distrito correspondiente','Unidad candidata para calles internas, aceras, obras vecinales y asuntos distritales. El distrito concreto debe confirmarse en la revisión de la denuncia.'),
('ALUMBRADO_PUBLICO','Dirección de Alumbrado Público','Mantenimiento de luminarias y postes de luz.'),
('SEMAPA','SEMAPA','Servicio Municipal de Agua Potable y Alcantarillado.'),
('EMAVRA','EMAVRA','Empresa Municipal de Áreas Verdes y Recreación Alternativa.'),
('PLANIFICACION_MEDIO_AMBIENTE','Secretaría de Planificación y Medio Ambiente','Coordinación ambiental cuando corresponda.'),
('EMSA','EMSA','Empresa Municipal de Servicio de Aseo.'),
('MEDIO_AMBIENTE','Dirección de Medio Ambiente','Coordinación en asuntos ambientales.'),
('URBANISMO','Dirección de Urbanismo','Asuntos de urbanismo y escombros en espacios públicos.'),
('SEGURIDAD_CIUDADANA','Dirección de Seguridad Ciudadana','Mantenimiento técnico de cámaras/centro de monitoreo.'),
('DESARROLLO_URBANO_CATASTRO','Secretaría de Desarrollo Urbano y Catastro','Asuntos de lotes baldíos, notificaciones y catastro.')
ON CONFLICT (code) DO NOTHING;

-- Reglas de sugerencia: se proponen unidades por categoría/subcategoría.
-- Si hay más de una candidata, el Moderador confirma la unidad apropiada.
INSERT INTO assignment_rules (category_id, subcategory_id, municipal_unit_id, priority, notes)
SELECT c.id, s.id, u.id, x.priority, x.notes
FROM (VALUES
 ('BACHES_PAVIMENTO','OBRAS_PUBLICAS',10,'Candidata principal según el documento de categorías; el Moderador puede cambiarla si corresponde a calle interna/secundaria.'),
 ('BACHES_PAVIMENTO','SUBALCALDIA_DISTRITO',20,'Candidata alternativa para calle interna/secundaria; el distrito se confirma durante la moderación.'),
 ('SENALIZACION_SEMAFOROS','MOVILIDAD_URBANA',10,'Unidad sugerida por el documento de categorías.'),
 ('ACERAS_RAMPAS','SUBALCALDIA_DISTRITO',10,'Unidad sugerida por el documento de categorías.'),
 ('ALUMBRADO_PUBLICO','ALUMBRADO_PUBLICO',10,'Unidad sugerida por el documento de categorías.'),
 ('FUGAS_AGUA_ALCANTARILLADO','SEMAPA',10,'Unidad sugerida por el documento de categorías.'),
 ('PARQUES_PLAZAS','EMAVRA',10,'Unidad sugerida por el documento de categorías.'),
 ('ARBOLES_PODA','EMAVRA',10,'Coordinar con Planificación y Medio Ambiente si corresponde.'),
 ('ARBOLES_PODA','PLANIFICACION_MEDIO_AMBIENTE',20,'Unidad candidata de coordinación cuando el caso requiera evaluación ambiental.'),
 ('AREAS_RECREATIVAS','EMAVRA',10,'Candidata para parques/equipamientos urbanos grandes.'),
 ('AREAS_RECREATIVAS','SUBALCALDIA_DISTRITO',20,'Candidata para canchas o espacios de barrio.'),
 ('BOTADEROS_CLANDESTINOS','EMSA',10,'Coordinar con Medio Ambiente.'),
 ('BOTADEROS_CLANDESTINOS','MEDIO_AMBIENTE',20,'Unidad candidata de coordinación ambiental.'),
 ('FALLAS_RECOLECCION','EMSA',10,'Unidad sugerida por el documento de categorías.'),
 ('ESCOMBROS_CONSTRUCCION','URBANISMO',10,'Candidata para intervención/sanción por ocupación de espacio público.'),
 ('ESCOMBROS_CONSTRUCCION','SUBALCALDIA_DISTRITO',20,'Candidata alternativa distrital.'),
 ('ESCOMBROS_CONSTRUCCION','EMSA',30,'Candidata para recolección especial si corresponde.'),
 ('CAMARAS_MUNICIPALES','SEGURIDAD_CIUDADANA',10,'Unidad sugerida por el documento de categorías.'),
 ('LOTES_ABANDONADOS','DESARROLLO_URBANO_CATASTRO',10,'Coordinar con la Subalcaldía del distrito correspondiente.'),
 ('LOTES_ABANDONADOS','SUBALCALDIA_DISTRITO',20,'Unidad candidata de coordinación distrital.')
) AS x(subcategory_code, unit_code, priority, notes)
JOIN subcategories s ON s.code = x.subcategory_code
JOIN categories c ON c.id = s.category_id
JOIN municipal_units u ON u.code = x.unit_code
ON CONFLICT (subcategory_id, municipal_unit_id) DO NOTHING;

COMMIT;
