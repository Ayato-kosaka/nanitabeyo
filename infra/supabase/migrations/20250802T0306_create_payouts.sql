-- 20250802T0306_create_payouts.sql
CREATE TABLE payouts (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    bid_id        UUID        NOT NULL REFERENCES restaurant_bids(id),
    transfer_id   TEXT        NOT NULL,
    dish_media_id UUID        NOT NULL REFERENCES dish_media(id),
    amount_cents  BIGINT      NOT NULL CHECK (amount_cents > 0),
    currency_code CHAR(3),
    status        bid_status  NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    lock_no       INTEGER     NOT NULL DEFAULT 0,
    UNIQUE (transfer_id),
    UNIQUE (bid_id, dish_media_id)  -- 二重払い防止
);

CREATE INDEX idx_payouts_media ON payouts (dish_media_id);
CREATE INDEX idx_payouts_created_at ON payouts (created_at);

COMMENT ON TABLE payouts IS '投稿者への支払いレコード';
ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;
