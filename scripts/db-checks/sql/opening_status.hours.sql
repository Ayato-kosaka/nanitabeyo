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
        roh.restaurant_id,
        roh.source,
        roh.day_of_week,
        roh.opens_at,
        roh.closes_at,
        roh.crosses_midnight
      FROM restaurant_opening_hours roh
      JOIN nearby_restaurants nr ON nr.restaurant_id = roh.restaurant_id
      WHERE roh.day_of_week IN (?,?);
