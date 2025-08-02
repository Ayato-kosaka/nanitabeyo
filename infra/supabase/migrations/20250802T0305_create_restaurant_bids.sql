CREATE TABLE restaurant_bids (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id    UUID        NOT NULL REFERENCES restaurants(id),
    user_id          UUID        NOT NULL REFERENCES users(id),
    payment_intent_id TEXT,
    amount_cents     BIGINT      NOT NULL CHECK (amount_cents > 0),
    currency_code    CHAR(3)     NOT NULL,
    start_date       DATE        NOT NULL,
    end_date         DATE        NOT NULL,
    status           bid_status  NOT NULL,
    refund_id        TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    lock_no          INTEGER     NOT NULL DEFAULT 0,
    CHECK (start_date < end_date)
);

CREATE INDEX idx_restaurant_bids_restaurant ON restaurant_bids (restaurant_id);

COMMENT ON TABLE restaurant_bids IS '広告入札レコード';
ALTER TABLE restaurant_bids ENABLE ROW LEVEL SECURITY;