-- ═══════════════════════════════════════════════════════════
--  T-SHIRT STORE API — Constraints que DBML no puede expresar
--
--  El .dbml genera tablas, enums, FKs e indices simples.
--  Todo lo de este archivo hay que agregarlo a mano en la
--  migracion de Prisma. Sin esto, el schema PERMITE estados
--  que la aplicacion considera imposibles.
-- ═══════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS citext;


-- ─────────────── Integridad del dinero ───────────────

-- La unica violacion de 3NF del schema, vuelta no representable.
-- Sin esto, total_cents es una convencion (R1); con esto, una garantia.
ALTER TABLE orders
  ADD CONSTRAINT total_matches_math
  CHECK (total_cents = subtotal_cents - discount_cents);

-- Juntas garantizan total_cents >= 0 sin un tercer CHECK.
ALTER TABLE orders
  ADD CONSTRAINT subtotal_non_negative CHECK (subtotal_cents >= 0),
  ADD CONSTRAINT discount_within_subtotal
    CHECK (discount_cents >= 0 AND discount_cents <= subtotal_cents);

ALTER TABLE order_items
  ADD CONSTRAINT order_item_qty_positive   CHECK (quantity > 0),
  ADD CONSTRAINT order_item_price_positive CHECK (unit_price_cents > 0);

ALTER TABLE cart_items
  ADD CONSTRAINT cart_item_qty_positive CHECK (quantity > 0);

ALTER TABLE payments
  ADD CONSTRAINT payment_amount_positive CHECK (amount_cents > 0);


-- ─────────────── Catalogo ───────────────

-- stock >= 0 es un BACKSTOP DE BUGS, no un mecanismo de deteccion.
-- El webhook nunca debe dejarlo disparar: usa el UPDATE condicional
-- de R3, porque una excepcion dentro de la transaccion del webhook
-- hace rollback, deja processed_at en NULL y dispara el bucle de
-- reintentos de 3 dias de Stripe.
ALTER TABLE product_variants
  ADD CONSTRAINT stock_non_negative CHECK (stock >= 0),
  ADD CONSTRAINT price_positive     CHECK (price_cents > 0);


-- ─────────────── Promo codes ───────────────

-- discount_value cambia de unidad segun discount_type, asi que el
-- CHECK tambien tiene que depender de ese campo. Sin esto, un cupon
-- PERCENTAGE con valor 5000 produce un total negativo.
ALTER TABLE promo_codes
  ADD CONSTRAINT discount_value_valid_for_type
  CHECK (
    (discount_type = 'PERCENTAGE' AND discount_value BETWEEN 1 AND 100)
    OR
    (discount_type = 'FIXED'      AND discount_value > 0)
  );

ALTER TABLE promo_codes
  ADD CONSTRAINT min_purchase_non_negative
    CHECK (min_purchase_cents IS NULL OR min_purchase_cents >= 0),
  ADD CONSTRAINT usage_limit_positive
    CHECK (usage_limit IS NULL OR usage_limit > 0);


-- ─────────────── Indices parciales ───────────────

-- Una orden puede tener varios intentos de pago, pero a lo sumo UNO
-- exitoso. Sin esto, dos filas SUCCEEDED = doble cobro silencioso, y
-- la feature 9 no sabe que metodo de pago mostrar.
-- Nota: por eso el reembolso es payments.refunded_at y no un valor
-- del enum; con status = 'REFUNDED' la fila saldria de este indice y
-- liberaria el slot para un segundo SUCCEEDED.
CREATE UNIQUE INDEX one_successful_payment_per_order
  ON payments (order_id)
  WHERE status = 'SUCCEEDED';

-- La unica consulta sobre stripe_events es "traeme los pendientes".
-- En regimen processed_at esta no-nula en casi todas las filas, asi
-- que el indice completo seria enorme e inutil. Este contiene decenas
-- de filas y ya viene ordenado por antiguedad, que es como se drenan.
CREATE INDEX stripe_events_unprocessed
  ON stripe_events (created_at)
  WHERE processed_at IS NULL;

-- Soft-deleting a variant keeps its row (order_items needs it for
-- history), so a plain UNIQUE(product_id, color_id, size_id) would
-- permanently block re-creating the same color+size combo after a
-- delete (e.g. discontinue fuchsia, then bring it back later). This
-- partial index only enforces uniqueness among live rows; a deleted
-- row simply stops counting.
CREATE UNIQUE INDEX product_variant_combo_unique
  ON product_variants (product_id, color_id, size_id)
  WHERE deleted_at IS NULL;


-- ═══════════════════════════════════════════════════════════
--  EVALUADO Y DESCARTADO — dejar constancia del porque
-- ═══════════════════════════════════════════════════════════

-- 1. FK compuesta para garantizar que delivery_person_id apunte a un
--    usuario con rol DELIVERY. Se puede:
--
--      ALTER TABLE users ADD CONSTRAINT users_id_role UNIQUE (id, role);
--      ALTER TABLE orders ADD COLUMN delivery_role user_role
--        GENERATED ALWAYS AS ('DELIVERY'::user_role) STORED;
--      ALTER TABLE orders ADD CONSTRAINT delivery_person_is_delivery
--        FOREIGN KEY (delivery_person_id, delivery_role)
--        REFERENCES users (id, role);
--
--    Descartado: demasiada ceremonia (un unique redundante mas una
--    columna generada) para el alcance. Se valida en la aplicacion.

-- 2. UNIQUE (order_id, status) en order_status_history.
--    Descartado: un Payment Link emite checkout.session.completed Y
--    payment_intent.succeeded para la misma compra, sin orden
--    garantizado. Si ambos handlers marcan PAID, el unique abortaria
--    la transaccion del webhook y produciria el mismo bucle de
--    reintentos que R8 evita. Un log append-only no debe poder
--    abortar la transaccion que audita.
--    La deteccion va como ALERTA DE MONITOREO, no como constraint:
--
--      SELECT order_id, status, count(*)
--        FROM order_status_history
--       GROUP BY order_id, status
--      HAVING count(*) > 1;
--
--    (material directo para el "what you would monitor" del
--     architecture write-up)

-- 3. UNIQUE (product_id, position) en product_images.
--    Descartado: las imagenes se reordenan seguido y el unique
--    exigiria constraint diferible o posiciones negativas
--    temporales. El determinismo se logra en la consulta:
--      ORDER BY position, created_at, id LIMIT 1
--    En sizes SI se aplica el unique, porque los talles se siembran
--    una vez y no se reordenan.

-- 4. CHECK (currency = 'USD') en orders y payments.
--    Opcional. Con una sola moneda declarada, vuelve honestas dos
--    columnas que hoy son constantes duplicadas.
