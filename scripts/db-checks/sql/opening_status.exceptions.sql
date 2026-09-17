WITH 
    knn_params AS (
      SELECT
        ST_SetSRID(
          ST_MakePoint(
            CAST(? AS double precision),
            CAST(? AS double precision)
          ),
          4326
        )::geography AS user_geog,
        CAST(? AS double precision) AS radius_m,
        CAST(? AS integer) AS knn_limit
    ),
    candidates_radius AS (
      SELECT
        r.id AS restaurant_id,
        r.location AS rest_geog
      FROM restaurants r
      WHERE ST_DWithin(
              r.location,
              (SELECT user_geog FROM knn_params),
              (SELECT radius_m FROM knn_params)
            )
    ),
    nearby_restaurants AS (
      SELECT cr.restaurant_id, cr.rest_geog
      FROM candidates_radius cr
      ORDER BY cr.rest_geog <-> (SELECT user_geog FROM knn_params)  -- KNN
      LIMIT (SELECT knn_limit FROM knn_params)
    )
  
      SELECT
        rhe.restaurant_id,
        rhe.source,
        rhe.exception_date,
        rhe.is_closed,
        rhe.opens_at,
        rhe.closes_at
      FROM restaurant_hours_exceptions rhe
      JOIN nearby_restaurants nr ON nr.restaurant_id = rhe.restaurant_id
      WHERE rhe.exception_date IN (?::date,?::date);
