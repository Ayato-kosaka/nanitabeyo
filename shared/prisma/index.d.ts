
/**
 * Client
**/

import * as runtime from './runtime/library.js';
import $Types = runtime.Types // general types
import $Public = runtime.Types.Public
import $Utils = runtime.Types.Utils
import $Extensions = runtime.Types.Extensions
import $Result = runtime.Types.Result

export type PrismaPromise<T> = $Public.PrismaPromise<T>


/**
 * Model dish_categories
 * This model or at least one of its fields has comments in the database, and requires an additional setup for migrations: Read more: https://pris.ly/d/database-comments
 * This model contains row level security and requires additional setup for migrations. Visit https://pris.ly/d/row-level-security for more info.
 */
export type dish_categories = $Result.DefaultSelection<Prisma.$dish_categoriesPayload>
/**
 * Model dish_category_variants
 * This model or at least one of its fields has comments in the database, and requires an additional setup for migrations: Read more: https://pris.ly/d/database-comments
 * This model contains row level security and requires additional setup for migrations. Visit https://pris.ly/d/row-level-security for more info.
 */
export type dish_category_variants = $Result.DefaultSelection<Prisma.$dish_category_variantsPayload>
/**
 * Model dish_likes
 * This model or at least one of its fields has comments in the database, and requires an additional setup for migrations: Read more: https://pris.ly/d/database-comments
 * This model contains row level security and requires additional setup for migrations. Visit https://pris.ly/d/row-level-security for more info.
 */
export type dish_likes = $Result.DefaultSelection<Prisma.$dish_likesPayload>
/**
 * Model dish_media
 * This table contains check constraints and requires additional setup for migrations. Visit https://pris.ly/d/check-constraints for more info.
 * This model or at least one of its fields has comments in the database, and requires an additional setup for migrations: Read more: https://pris.ly/d/database-comments
 * This model contains row level security and requires additional setup for migrations. Visit https://pris.ly/d/row-level-security for more info.
 */
export type dish_media = $Result.DefaultSelection<Prisma.$dish_mediaPayload>
/**
 * Model dish_reviews
 * This table contains check constraints and requires additional setup for migrations. Visit https://pris.ly/d/check-constraints for more info.
 * This model or at least one of its fields has comments in the database, and requires an additional setup for migrations: Read more: https://pris.ly/d/database-comments
 * This model contains row level security and requires additional setup for migrations. Visit https://pris.ly/d/row-level-security for more info.
 */
export type dish_reviews = $Result.DefaultSelection<Prisma.$dish_reviewsPayload>
/**
 * Model dishes
 * This model or at least one of its fields has comments in the database, and requires an additional setup for migrations: Read more: https://pris.ly/d/database-comments
 * This model contains row level security and requires additional setup for migrations. Visit https://pris.ly/d/row-level-security for more info.
 */
export type dishes = $Result.DefaultSelection<Prisma.$dishesPayload>
/**
 * Model payouts
 * This table contains check constraints and requires additional setup for migrations. Visit https://pris.ly/d/check-constraints for more info.
 * This model or at least one of its fields has comments in the database, and requires an additional setup for migrations: Read more: https://pris.ly/d/database-comments
 * This model contains row level security and requires additional setup for migrations. Visit https://pris.ly/d/row-level-security for more info.
 */
export type payouts = $Result.DefaultSelection<Prisma.$payoutsPayload>
/**
 * Model restaurant_bids
 * This table contains check constraints and requires additional setup for migrations. Visit https://pris.ly/d/check-constraints for more info.
 * This model or at least one of its fields has comments in the database, and requires an additional setup for migrations: Read more: https://pris.ly/d/database-comments
 * This model contains row level security and requires additional setup for migrations. Visit https://pris.ly/d/row-level-security for more info.
 */
export type restaurant_bids = $Result.DefaultSelection<Prisma.$restaurant_bidsPayload>
/**
 * Model restaurants
 * This model or at least one of its fields has comments in the database, and requires an additional setup for migrations: Read more: https://pris.ly/d/database-comments
 * This model contains row level security and requires additional setup for migrations. Visit https://pris.ly/d/row-level-security for more info.
 */
export type restaurants = $Result.DefaultSelection<Prisma.$restaurantsPayload>
/**
 * Model spatial_ref_sys
 * This table contains check constraints and requires additional setup for migrations. Visit https://pris.ly/d/check-constraints for more info.
 */
export type spatial_ref_sys = $Result.DefaultSelection<Prisma.$spatial_ref_sysPayload>
/**
 * Model users
 * This model or at least one of its fields has comments in the database, and requires an additional setup for migrations: Read more: https://pris.ly/d/database-comments
 * This model contains row level security and requires additional setup for migrations. Visit https://pris.ly/d/row-level-security for more info.
 */
export type users = $Result.DefaultSelection<Prisma.$usersPayload>

/**
 * Enums
 */
export namespace $Enums {
  export const payout_status: {
  pending: 'pending',
  paid: 'paid',
  refunded: 'refunded'
};

export type payout_status = (typeof payout_status)[keyof typeof payout_status]


export const restaurant_bid_status: {
  pending: 'pending',
  paid: 'paid',
  refunded: 'refunded'
};

export type restaurant_bid_status = (typeof restaurant_bid_status)[keyof typeof restaurant_bid_status]

}

export type payout_status = $Enums.payout_status

export const payout_status: typeof $Enums.payout_status

export type restaurant_bid_status = $Enums.restaurant_bid_status

export const restaurant_bid_status: typeof $Enums.restaurant_bid_status

/**
 * ##  Prisma Client ʲˢ
 *
 * Type-safe database client for TypeScript & Node.js
 * @example
 * ```
 * const prisma = new PrismaClient()
 * // Fetch zero or more Dish_categories
 * const dish_categories = await prisma.dish_categories.findMany()
 * ```
 *
 *
 * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client).
 */
export class PrismaClient<
  ClientOptions extends Prisma.PrismaClientOptions = Prisma.PrismaClientOptions,
  const U = 'log' extends keyof ClientOptions ? ClientOptions['log'] extends Array<Prisma.LogLevel | Prisma.LogDefinition> ? Prisma.GetEvents<ClientOptions['log']> : never : never,
  ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs
> {
  [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['other'] }

    /**
   * ##  Prisma Client ʲˢ
   *
   * Type-safe database client for TypeScript & Node.js
   * @example
   * ```
   * const prisma = new PrismaClient()
   * // Fetch zero or more Dish_categories
   * const dish_categories = await prisma.dish_categories.findMany()
   * ```
   *
   *
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client).
   */

  constructor(optionsArg ?: Prisma.Subset<ClientOptions, Prisma.PrismaClientOptions>);
  $on<V extends U>(eventType: V, callback: (event: V extends 'query' ? Prisma.QueryEvent : Prisma.LogEvent) => void): PrismaClient;

  /**
   * Connect with the database
   */
  $connect(): $Utils.JsPromise<void>;

  /**
   * Disconnect from the database
   */
  $disconnect(): $Utils.JsPromise<void>;

  /**
   * Add a middleware
   * @deprecated since 4.16.0. For new code, prefer client extensions instead.
   * @see https://pris.ly/d/extensions
   */
  $use(cb: Prisma.Middleware): void

/**
   * Executes a prepared raw query and returns the number of affected rows.
   * @example
   * ```
   * const result = await prisma.$executeRaw`UPDATE User SET cool = ${true} WHERE email = ${'user@email.com'};`
   * ```
   *
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $executeRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Prisma.PrismaPromise<number>;

  /**
   * Executes a raw query and returns the number of affected rows.
   * Susceptible to SQL injections, see documentation.
   * @example
   * ```
   * const result = await prisma.$executeRawUnsafe('UPDATE User SET cool = $1 WHERE email = $2 ;', true, 'user@email.com')
   * ```
   *
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $executeRawUnsafe<T = unknown>(query: string, ...values: any[]): Prisma.PrismaPromise<number>;

  /**
   * Performs a prepared raw query and returns the `SELECT` data.
   * @example
   * ```
   * const result = await prisma.$queryRaw`SELECT * FROM User WHERE id = ${1} OR email = ${'user@email.com'};`
   * ```
   *
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $queryRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Prisma.PrismaPromise<T>;

  /**
   * Performs a raw query and returns the `SELECT` data.
   * Susceptible to SQL injections, see documentation.
   * @example
   * ```
   * const result = await prisma.$queryRawUnsafe('SELECT * FROM User WHERE id = $1 OR email = $2;', 1, 'user@email.com')
   * ```
   *
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $queryRawUnsafe<T = unknown>(query: string, ...values: any[]): Prisma.PrismaPromise<T>;


  /**
   * Allows the running of a sequence of read/write operations that are guaranteed to either succeed or fail as a whole.
   * @example
   * ```
   * const [george, bob, alice] = await prisma.$transaction([
   *   prisma.user.create({ data: { name: 'George' } }),
   *   prisma.user.create({ data: { name: 'Bob' } }),
   *   prisma.user.create({ data: { name: 'Alice' } }),
   * ])
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/concepts/components/prisma-client/transactions).
   */
  $transaction<P extends Prisma.PrismaPromise<any>[]>(arg: [...P], options?: { isolationLevel?: Prisma.TransactionIsolationLevel }): $Utils.JsPromise<runtime.Types.Utils.UnwrapTuple<P>>

  $transaction<R>(fn: (prisma: Omit<PrismaClient, runtime.ITXClientDenyList>) => $Utils.JsPromise<R>, options?: { maxWait?: number, timeout?: number, isolationLevel?: Prisma.TransactionIsolationLevel }): $Utils.JsPromise<R>


  $extends: $Extensions.ExtendsHook<"extends", Prisma.TypeMapCb<ClientOptions>, ExtArgs, $Utils.Call<Prisma.TypeMapCb<ClientOptions>, {
    extArgs: ExtArgs
  }>>

      /**
   * `prisma.dish_categories`: Exposes CRUD operations for the **dish_categories** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Dish_categories
    * const dish_categories = await prisma.dish_categories.findMany()
    * ```
    */
  get dish_categories(): Prisma.dish_categoriesDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.dish_category_variants`: Exposes CRUD operations for the **dish_category_variants** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Dish_category_variants
    * const dish_category_variants = await prisma.dish_category_variants.findMany()
    * ```
    */
  get dish_category_variants(): Prisma.dish_category_variantsDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.dish_likes`: Exposes CRUD operations for the **dish_likes** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Dish_likes
    * const dish_likes = await prisma.dish_likes.findMany()
    * ```
    */
  get dish_likes(): Prisma.dish_likesDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.dish_media`: Exposes CRUD operations for the **dish_media** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Dish_medias
    * const dish_medias = await prisma.dish_media.findMany()
    * ```
    */
  get dish_media(): Prisma.dish_mediaDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.dish_reviews`: Exposes CRUD operations for the **dish_reviews** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Dish_reviews
    * const dish_reviews = await prisma.dish_reviews.findMany()
    * ```
    */
  get dish_reviews(): Prisma.dish_reviewsDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.dishes`: Exposes CRUD operations for the **dishes** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Dishes
    * const dishes = await prisma.dishes.findMany()
    * ```
    */
  get dishes(): Prisma.dishesDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.payouts`: Exposes CRUD operations for the **payouts** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Payouts
    * const payouts = await prisma.payouts.findMany()
    * ```
    */
  get payouts(): Prisma.payoutsDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.restaurant_bids`: Exposes CRUD operations for the **restaurant_bids** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Restaurant_bids
    * const restaurant_bids = await prisma.restaurant_bids.findMany()
    * ```
    */
  get restaurant_bids(): Prisma.restaurant_bidsDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.restaurants`: Exposes CRUD operations for the **restaurants** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Restaurants
    * const restaurants = await prisma.restaurants.findMany()
    * ```
    */
  get restaurants(): Prisma.restaurantsDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.spatial_ref_sys`: Exposes CRUD operations for the **spatial_ref_sys** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Spatial_ref_sys
    * const spatial_ref_sys = await prisma.spatial_ref_sys.findMany()
    * ```
    */
  get spatial_ref_sys(): Prisma.spatial_ref_sysDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.users`: Exposes CRUD operations for the **users** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Users
    * const users = await prisma.users.findMany()
    * ```
    */
  get users(): Prisma.usersDelegate<ExtArgs, ClientOptions>;
}

export namespace Prisma {
  export import DMMF = runtime.DMMF

  export type PrismaPromise<T> = $Public.PrismaPromise<T>

  /**
   * Validator
   */
  export import validator = runtime.Public.validator

  /**
   * Prisma Errors
   */
  export import PrismaClientKnownRequestError = runtime.PrismaClientKnownRequestError
  export import PrismaClientUnknownRequestError = runtime.PrismaClientUnknownRequestError
  export import PrismaClientRustPanicError = runtime.PrismaClientRustPanicError
  export import PrismaClientInitializationError = runtime.PrismaClientInitializationError
  export import PrismaClientValidationError = runtime.PrismaClientValidationError

  /**
   * Re-export of sql-template-tag
   */
  export import sql = runtime.sqltag
  export import empty = runtime.empty
  export import join = runtime.join
  export import raw = runtime.raw
  export import Sql = runtime.Sql



  /**
   * Decimal.js
   */
  export import Decimal = runtime.Decimal

  export type DecimalJsLike = runtime.DecimalJsLike

  /**
   * Metrics
   */
  export type Metrics = runtime.Metrics
  export type Metric<T> = runtime.Metric<T>
  export type MetricHistogram = runtime.MetricHistogram
  export type MetricHistogramBucket = runtime.MetricHistogramBucket

  /**
  * Extensions
  */
  export import Extension = $Extensions.UserArgs
  export import getExtensionContext = runtime.Extensions.getExtensionContext
  export import Args = $Public.Args
  export import Payload = $Public.Payload
  export import Result = $Public.Result
  export import Exact = $Public.Exact

  /**
   * Prisma Client JS version: 6.13.0
   * Query Engine version: 361e86d0ea4987e9f53a565309b3eed797a6bcbd
   */
  export type PrismaVersion = {
    client: string
  }

  export const prismaVersion: PrismaVersion

  /**
   * Utility Types
   */


  export import JsonObject = runtime.JsonObject
  export import JsonArray = runtime.JsonArray
  export import JsonValue = runtime.JsonValue
  export import InputJsonObject = runtime.InputJsonObject
  export import InputJsonArray = runtime.InputJsonArray
  export import InputJsonValue = runtime.InputJsonValue

  /**
   * Types of the values used to represent different kinds of `null` values when working with JSON fields.
   *
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  namespace NullTypes {
    /**
    * Type of `Prisma.DbNull`.
    *
    * You cannot use other instances of this class. Please use the `Prisma.DbNull` value.
    *
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class DbNull {
      private DbNull: never
      private constructor()
    }

    /**
    * Type of `Prisma.JsonNull`.
    *
    * You cannot use other instances of this class. Please use the `Prisma.JsonNull` value.
    *
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class JsonNull {
      private JsonNull: never
      private constructor()
    }

    /**
    * Type of `Prisma.AnyNull`.
    *
    * You cannot use other instances of this class. Please use the `Prisma.AnyNull` value.
    *
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class AnyNull {
      private AnyNull: never
      private constructor()
    }
  }

  /**
   * Helper for filtering JSON entries that have `null` on the database (empty on the db)
   *
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const DbNull: NullTypes.DbNull

  /**
   * Helper for filtering JSON entries that have JSON `null` values (not empty on the db)
   *
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const JsonNull: NullTypes.JsonNull

  /**
   * Helper for filtering JSON entries that are `Prisma.DbNull` or `Prisma.JsonNull`
   *
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const AnyNull: NullTypes.AnyNull

  type SelectAndInclude = {
    select: any
    include: any
  }

  type SelectAndOmit = {
    select: any
    omit: any
  }

  /**
   * Get the type of the value, that the Promise holds.
   */
  export type PromiseType<T extends PromiseLike<any>> = T extends PromiseLike<infer U> ? U : T;

  /**
   * Get the return type of a function which returns a Promise.
   */
  export type PromiseReturnType<T extends (...args: any) => $Utils.JsPromise<any>> = PromiseType<ReturnType<T>>

  /**
   * From T, pick a set of properties whose keys are in the union K
   */
  type Prisma__Pick<T, K extends keyof T> = {
      [P in K]: T[P];
  };


  export type Enumerable<T> = T | Array<T>;

  export type RequiredKeys<T> = {
    [K in keyof T]-?: {} extends Prisma__Pick<T, K> ? never : K
  }[keyof T]

  export type TruthyKeys<T> = keyof {
    [K in keyof T as T[K] extends false | undefined | null ? never : K]: K
  }

  export type TrueKeys<T> = TruthyKeys<Prisma__Pick<T, RequiredKeys<T>>>

  /**
   * Subset
   * @desc From `T` pick properties that exist in `U`. Simple version of Intersection
   */
  export type Subset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never;
  };

  /**
   * SelectSubset
   * @desc From `T` pick properties that exist in `U`. Simple version of Intersection.
   * Additionally, it validates, if both select and include are present. If the case, it errors.
   */
  export type SelectSubset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } &
    (T extends SelectAndInclude
      ? 'Please either choose `select` or `include`.'
      : T extends SelectAndOmit
        ? 'Please either choose `select` or `omit`.'
        : {})

  /**
   * Subset + Intersection
   * @desc From `T` pick properties that exist in `U` and intersect `K`
   */
  export type SubsetIntersection<T, U, K> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } &
    K

  type Without<T, U> = { [P in Exclude<keyof T, keyof U>]?: never };

  /**
   * XOR is needed to have a real mutually exclusive union type
   * https://stackoverflow.com/questions/42123407/does-typescript-support-mutually-exclusive-types
   */
  type XOR<T, U> =
    T extends object ?
    U extends object ?
      (Without<T, U> & U) | (Without<U, T> & T)
    : U : T


  /**
   * Is T a Record?
   */
  type IsObject<T extends any> = T extends Array<any>
  ? False
  : T extends Date
  ? False
  : T extends Uint8Array
  ? False
  : T extends BigInt
  ? False
  : T extends object
  ? True
  : False


  /**
   * If it's T[], return T
   */
  export type UnEnumerate<T extends unknown> = T extends Array<infer U> ? U : T

  /**
   * From ts-toolbelt
   */

  type __Either<O extends object, K extends Key> = Omit<O, K> &
    {
      // Merge all but K
      [P in K]: Prisma__Pick<O, P & keyof O> // With K possibilities
    }[K]

  type EitherStrict<O extends object, K extends Key> = Strict<__Either<O, K>>

  type EitherLoose<O extends object, K extends Key> = ComputeRaw<__Either<O, K>>

  type _Either<
    O extends object,
    K extends Key,
    strict extends Boolean
  > = {
    1: EitherStrict<O, K>
    0: EitherLoose<O, K>
  }[strict]

  type Either<
    O extends object,
    K extends Key,
    strict extends Boolean = 1
  > = O extends unknown ? _Either<O, K, strict> : never

  export type Union = any

  type PatchUndefined<O extends object, O1 extends object> = {
    [K in keyof O]: O[K] extends undefined ? At<O1, K> : O[K]
  } & {}

  /** Helper Types for "Merge" **/
  export type IntersectOf<U extends Union> = (
    U extends unknown ? (k: U) => void : never
  ) extends (k: infer I) => void
    ? I
    : never

  export type Overwrite<O extends object, O1 extends object> = {
      [K in keyof O]: K extends keyof O1 ? O1[K] : O[K];
  } & {};

  type _Merge<U extends object> = IntersectOf<Overwrite<U, {
      [K in keyof U]-?: At<U, K>;
  }>>;

  type Key = string | number | symbol;
  type AtBasic<O extends object, K extends Key> = K extends keyof O ? O[K] : never;
  type AtStrict<O extends object, K extends Key> = O[K & keyof O];
  type AtLoose<O extends object, K extends Key> = O extends unknown ? AtStrict<O, K> : never;
  export type At<O extends object, K extends Key, strict extends Boolean = 1> = {
      1: AtStrict<O, K>;
      0: AtLoose<O, K>;
  }[strict];

  export type ComputeRaw<A extends any> = A extends Function ? A : {
    [K in keyof A]: A[K];
  } & {};

  export type OptionalFlat<O> = {
    [K in keyof O]?: O[K];
  } & {};

  type _Record<K extends keyof any, T> = {
    [P in K]: T;
  };

  // cause typescript not to expand types and preserve names
  type NoExpand<T> = T extends unknown ? T : never;

  // this type assumes the passed object is entirely optional
  type AtLeast<O extends object, K extends string> = NoExpand<
    O extends unknown
    ? | (K extends keyof O ? { [P in K]: O[P] } & O : O)
      | {[P in keyof O as P extends K ? P : never]-?: O[P]} & O
    : never>;

  type _Strict<U, _U = U> = U extends unknown ? U & OptionalFlat<_Record<Exclude<Keys<_U>, keyof U>, never>> : never;

  export type Strict<U extends object> = ComputeRaw<_Strict<U>>;
  /** End Helper Types for "Merge" **/

  export type Merge<U extends object> = ComputeRaw<_Merge<Strict<U>>>;

  /**
  A [[Boolean]]
  */
  export type Boolean = True | False

  // /**
  // 1
  // */
  export type True = 1

  /**
  0
  */
  export type False = 0

  export type Not<B extends Boolean> = {
    0: 1
    1: 0
  }[B]

  export type Extends<A1 extends any, A2 extends any> = [A1] extends [never]
    ? 0 // anything `never` is false
    : A1 extends A2
    ? 1
    : 0

  export type Has<U extends Union, U1 extends Union> = Not<
    Extends<Exclude<U1, U>, U1>
  >

  export type Or<B1 extends Boolean, B2 extends Boolean> = {
    0: {
      0: 0
      1: 1
    }
    1: {
      0: 1
      1: 1
    }
  }[B1][B2]

  export type Keys<U extends Union> = U extends unknown ? keyof U : never

  type Cast<A, B> = A extends B ? A : B;

  export const type: unique symbol;



  /**
   * Used by group by
   */

  export type GetScalarType<T, O> = O extends object ? {
    [P in keyof T]: P extends keyof O
      ? O[P]
      : never
  } : never

  type FieldPaths<
    T,
    U = Omit<T, '_avg' | '_sum' | '_count' | '_min' | '_max'>
  > = IsObject<T> extends True ? U : T

  type GetHavingFields<T> = {
    [K in keyof T]: Or<
      Or<Extends<'OR', K>, Extends<'AND', K>>,
      Extends<'NOT', K>
    > extends True
      ? // infer is only needed to not hit TS limit
        // based on the brilliant idea of Pierre-Antoine Mills
        // https://github.com/microsoft/TypeScript/issues/30188#issuecomment-478938437
        T[K] extends infer TK
        ? GetHavingFields<UnEnumerate<TK> extends object ? Merge<UnEnumerate<TK>> : never>
        : never
      : {} extends FieldPaths<T[K]>
      ? never
      : K
  }[keyof T]

  /**
   * Convert tuple to union
   */
  type _TupleToUnion<T> = T extends (infer E)[] ? E : never
  type TupleToUnion<K extends readonly any[]> = _TupleToUnion<K>
  type MaybeTupleToUnion<T> = T extends any[] ? TupleToUnion<T> : T

  /**
   * Like `Pick`, but additionally can also accept an array of keys
   */
  type PickEnumerable<T, K extends Enumerable<keyof T> | keyof T> = Prisma__Pick<T, MaybeTupleToUnion<K>>

  /**
   * Exclude all keys with underscores
   */
  type ExcludeUnderscoreKeys<T extends string> = T extends `_${string}` ? never : T


  export type FieldRef<Model, FieldType> = runtime.FieldRef<Model, FieldType>

  type FieldRefInputType<Model, FieldType> = Model extends never ? never : FieldRef<Model, FieldType>


  export const ModelName: {
    dish_categories: 'dish_categories',
    dish_category_variants: 'dish_category_variants',
    dish_likes: 'dish_likes',
    dish_media: 'dish_media',
    dish_reviews: 'dish_reviews',
    dishes: 'dishes',
    payouts: 'payouts',
    restaurant_bids: 'restaurant_bids',
    restaurants: 'restaurants',
    spatial_ref_sys: 'spatial_ref_sys',
    users: 'users'
  };

  export type ModelName = (typeof ModelName)[keyof typeof ModelName]


  export type Datasources = {
    db?: Datasource
  }

  interface TypeMapCb<ClientOptions = {}> extends $Utils.Fn<{extArgs: $Extensions.InternalArgs }, $Utils.Record<string, any>> {
    returns: Prisma.TypeMap<this['params']['extArgs'], ClientOptions extends { omit: infer OmitOptions } ? OmitOptions : {}>
  }

  export type TypeMap<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> = {
    globalOmitOptions: {
      omit: GlobalOmitOptions
    }
    meta: {
      modelProps: "dish_categories" | "dish_category_variants" | "dish_likes" | "dish_media" | "dish_reviews" | "dishes" | "payouts" | "restaurant_bids" | "restaurants" | "spatial_ref_sys" | "users"
      txIsolationLevel: Prisma.TransactionIsolationLevel
    }
    model: {
      dish_categories: {
        payload: Prisma.$dish_categoriesPayload<ExtArgs>
        fields: Prisma.dish_categoriesFieldRefs
        operations: {
          findUnique: {
            args: Prisma.dish_categoriesFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_categoriesPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.dish_categoriesFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_categoriesPayload>
          }
          findFirst: {
            args: Prisma.dish_categoriesFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_categoriesPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.dish_categoriesFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_categoriesPayload>
          }
          findMany: {
            args: Prisma.dish_categoriesFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_categoriesPayload>[]
          }
          create: {
            args: Prisma.dish_categoriesCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_categoriesPayload>
          }
          createMany: {
            args: Prisma.dish_categoriesCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.dish_categoriesCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_categoriesPayload>[]
          }
          delete: {
            args: Prisma.dish_categoriesDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_categoriesPayload>
          }
          update: {
            args: Prisma.dish_categoriesUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_categoriesPayload>
          }
          deleteMany: {
            args: Prisma.dish_categoriesDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.dish_categoriesUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.dish_categoriesUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_categoriesPayload>[]
          }
          upsert: {
            args: Prisma.dish_categoriesUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_categoriesPayload>
          }
          aggregate: {
            args: Prisma.Dish_categoriesAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateDish_categories>
          }
          groupBy: {
            args: Prisma.dish_categoriesGroupByArgs<ExtArgs>
            result: $Utils.Optional<Dish_categoriesGroupByOutputType>[]
          }
          count: {
            args: Prisma.dish_categoriesCountArgs<ExtArgs>
            result: $Utils.Optional<Dish_categoriesCountAggregateOutputType> | number
          }
        }
      }
      dish_category_variants: {
        payload: Prisma.$dish_category_variantsPayload<ExtArgs>
        fields: Prisma.dish_category_variantsFieldRefs
        operations: {
          findUnique: {
            args: Prisma.dish_category_variantsFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_category_variantsPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.dish_category_variantsFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_category_variantsPayload>
          }
          findFirst: {
            args: Prisma.dish_category_variantsFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_category_variantsPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.dish_category_variantsFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_category_variantsPayload>
          }
          findMany: {
            args: Prisma.dish_category_variantsFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_category_variantsPayload>[]
          }
          create: {
            args: Prisma.dish_category_variantsCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_category_variantsPayload>
          }
          createMany: {
            args: Prisma.dish_category_variantsCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.dish_category_variantsCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_category_variantsPayload>[]
          }
          delete: {
            args: Prisma.dish_category_variantsDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_category_variantsPayload>
          }
          update: {
            args: Prisma.dish_category_variantsUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_category_variantsPayload>
          }
          deleteMany: {
            args: Prisma.dish_category_variantsDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.dish_category_variantsUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.dish_category_variantsUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_category_variantsPayload>[]
          }
          upsert: {
            args: Prisma.dish_category_variantsUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_category_variantsPayload>
          }
          aggregate: {
            args: Prisma.Dish_category_variantsAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateDish_category_variants>
          }
          groupBy: {
            args: Prisma.dish_category_variantsGroupByArgs<ExtArgs>
            result: $Utils.Optional<Dish_category_variantsGroupByOutputType>[]
          }
          count: {
            args: Prisma.dish_category_variantsCountArgs<ExtArgs>
            result: $Utils.Optional<Dish_category_variantsCountAggregateOutputType> | number
          }
        }
      }
      dish_likes: {
        payload: Prisma.$dish_likesPayload<ExtArgs>
        fields: Prisma.dish_likesFieldRefs
        operations: {
          findUnique: {
            args: Prisma.dish_likesFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_likesPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.dish_likesFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_likesPayload>
          }
          findFirst: {
            args: Prisma.dish_likesFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_likesPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.dish_likesFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_likesPayload>
          }
          findMany: {
            args: Prisma.dish_likesFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_likesPayload>[]
          }
          create: {
            args: Prisma.dish_likesCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_likesPayload>
          }
          createMany: {
            args: Prisma.dish_likesCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.dish_likesCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_likesPayload>[]
          }
          delete: {
            args: Prisma.dish_likesDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_likesPayload>
          }
          update: {
            args: Prisma.dish_likesUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_likesPayload>
          }
          deleteMany: {
            args: Prisma.dish_likesDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.dish_likesUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.dish_likesUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_likesPayload>[]
          }
          upsert: {
            args: Prisma.dish_likesUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_likesPayload>
          }
          aggregate: {
            args: Prisma.Dish_likesAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateDish_likes>
          }
          groupBy: {
            args: Prisma.dish_likesGroupByArgs<ExtArgs>
            result: $Utils.Optional<Dish_likesGroupByOutputType>[]
          }
          count: {
            args: Prisma.dish_likesCountArgs<ExtArgs>
            result: $Utils.Optional<Dish_likesCountAggregateOutputType> | number
          }
        }
      }
      dish_media: {
        payload: Prisma.$dish_mediaPayload<ExtArgs>
        fields: Prisma.dish_mediaFieldRefs
        operations: {
          findUnique: {
            args: Prisma.dish_mediaFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_mediaPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.dish_mediaFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_mediaPayload>
          }
          findFirst: {
            args: Prisma.dish_mediaFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_mediaPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.dish_mediaFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_mediaPayload>
          }
          findMany: {
            args: Prisma.dish_mediaFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_mediaPayload>[]
          }
          create: {
            args: Prisma.dish_mediaCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_mediaPayload>
          }
          createMany: {
            args: Prisma.dish_mediaCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.dish_mediaCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_mediaPayload>[]
          }
          delete: {
            args: Prisma.dish_mediaDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_mediaPayload>
          }
          update: {
            args: Prisma.dish_mediaUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_mediaPayload>
          }
          deleteMany: {
            args: Prisma.dish_mediaDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.dish_mediaUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.dish_mediaUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_mediaPayload>[]
          }
          upsert: {
            args: Prisma.dish_mediaUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_mediaPayload>
          }
          aggregate: {
            args: Prisma.Dish_mediaAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateDish_media>
          }
          groupBy: {
            args: Prisma.dish_mediaGroupByArgs<ExtArgs>
            result: $Utils.Optional<Dish_mediaGroupByOutputType>[]
          }
          count: {
            args: Prisma.dish_mediaCountArgs<ExtArgs>
            result: $Utils.Optional<Dish_mediaCountAggregateOutputType> | number
          }
        }
      }
      dish_reviews: {
        payload: Prisma.$dish_reviewsPayload<ExtArgs>
        fields: Prisma.dish_reviewsFieldRefs
        operations: {
          findUnique: {
            args: Prisma.dish_reviewsFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_reviewsPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.dish_reviewsFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_reviewsPayload>
          }
          findFirst: {
            args: Prisma.dish_reviewsFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_reviewsPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.dish_reviewsFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_reviewsPayload>
          }
          findMany: {
            args: Prisma.dish_reviewsFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_reviewsPayload>[]
          }
          create: {
            args: Prisma.dish_reviewsCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_reviewsPayload>
          }
          createMany: {
            args: Prisma.dish_reviewsCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.dish_reviewsCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_reviewsPayload>[]
          }
          delete: {
            args: Prisma.dish_reviewsDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_reviewsPayload>
          }
          update: {
            args: Prisma.dish_reviewsUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_reviewsPayload>
          }
          deleteMany: {
            args: Prisma.dish_reviewsDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.dish_reviewsUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.dish_reviewsUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_reviewsPayload>[]
          }
          upsert: {
            args: Prisma.dish_reviewsUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dish_reviewsPayload>
          }
          aggregate: {
            args: Prisma.Dish_reviewsAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateDish_reviews>
          }
          groupBy: {
            args: Prisma.dish_reviewsGroupByArgs<ExtArgs>
            result: $Utils.Optional<Dish_reviewsGroupByOutputType>[]
          }
          count: {
            args: Prisma.dish_reviewsCountArgs<ExtArgs>
            result: $Utils.Optional<Dish_reviewsCountAggregateOutputType> | number
          }
        }
      }
      dishes: {
        payload: Prisma.$dishesPayload<ExtArgs>
        fields: Prisma.dishesFieldRefs
        operations: {
          findUnique: {
            args: Prisma.dishesFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dishesPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.dishesFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dishesPayload>
          }
          findFirst: {
            args: Prisma.dishesFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dishesPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.dishesFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dishesPayload>
          }
          findMany: {
            args: Prisma.dishesFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dishesPayload>[]
          }
          create: {
            args: Prisma.dishesCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dishesPayload>
          }
          createMany: {
            args: Prisma.dishesCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.dishesCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dishesPayload>[]
          }
          delete: {
            args: Prisma.dishesDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dishesPayload>
          }
          update: {
            args: Prisma.dishesUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dishesPayload>
          }
          deleteMany: {
            args: Prisma.dishesDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.dishesUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.dishesUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dishesPayload>[]
          }
          upsert: {
            args: Prisma.dishesUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$dishesPayload>
          }
          aggregate: {
            args: Prisma.DishesAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateDishes>
          }
          groupBy: {
            args: Prisma.dishesGroupByArgs<ExtArgs>
            result: $Utils.Optional<DishesGroupByOutputType>[]
          }
          count: {
            args: Prisma.dishesCountArgs<ExtArgs>
            result: $Utils.Optional<DishesCountAggregateOutputType> | number
          }
        }
      }
      payouts: {
        payload: Prisma.$payoutsPayload<ExtArgs>
        fields: Prisma.payoutsFieldRefs
        operations: {
          findUnique: {
            args: Prisma.payoutsFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$payoutsPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.payoutsFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$payoutsPayload>
          }
          findFirst: {
            args: Prisma.payoutsFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$payoutsPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.payoutsFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$payoutsPayload>
          }
          findMany: {
            args: Prisma.payoutsFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$payoutsPayload>[]
          }
          create: {
            args: Prisma.payoutsCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$payoutsPayload>
          }
          createMany: {
            args: Prisma.payoutsCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.payoutsCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$payoutsPayload>[]
          }
          delete: {
            args: Prisma.payoutsDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$payoutsPayload>
          }
          update: {
            args: Prisma.payoutsUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$payoutsPayload>
          }
          deleteMany: {
            args: Prisma.payoutsDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.payoutsUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.payoutsUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$payoutsPayload>[]
          }
          upsert: {
            args: Prisma.payoutsUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$payoutsPayload>
          }
          aggregate: {
            args: Prisma.PayoutsAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregatePayouts>
          }
          groupBy: {
            args: Prisma.payoutsGroupByArgs<ExtArgs>
            result: $Utils.Optional<PayoutsGroupByOutputType>[]
          }
          count: {
            args: Prisma.payoutsCountArgs<ExtArgs>
            result: $Utils.Optional<PayoutsCountAggregateOutputType> | number
          }
        }
      }
      restaurant_bids: {
        payload: Prisma.$restaurant_bidsPayload<ExtArgs>
        fields: Prisma.restaurant_bidsFieldRefs
        operations: {
          findUnique: {
            args: Prisma.restaurant_bidsFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$restaurant_bidsPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.restaurant_bidsFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$restaurant_bidsPayload>
          }
          findFirst: {
            args: Prisma.restaurant_bidsFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$restaurant_bidsPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.restaurant_bidsFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$restaurant_bidsPayload>
          }
          findMany: {
            args: Prisma.restaurant_bidsFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$restaurant_bidsPayload>[]
          }
          create: {
            args: Prisma.restaurant_bidsCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$restaurant_bidsPayload>
          }
          createMany: {
            args: Prisma.restaurant_bidsCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.restaurant_bidsCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$restaurant_bidsPayload>[]
          }
          delete: {
            args: Prisma.restaurant_bidsDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$restaurant_bidsPayload>
          }
          update: {
            args: Prisma.restaurant_bidsUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$restaurant_bidsPayload>
          }
          deleteMany: {
            args: Prisma.restaurant_bidsDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.restaurant_bidsUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.restaurant_bidsUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$restaurant_bidsPayload>[]
          }
          upsert: {
            args: Prisma.restaurant_bidsUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$restaurant_bidsPayload>
          }
          aggregate: {
            args: Prisma.Restaurant_bidsAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateRestaurant_bids>
          }
          groupBy: {
            args: Prisma.restaurant_bidsGroupByArgs<ExtArgs>
            result: $Utils.Optional<Restaurant_bidsGroupByOutputType>[]
          }
          count: {
            args: Prisma.restaurant_bidsCountArgs<ExtArgs>
            result: $Utils.Optional<Restaurant_bidsCountAggregateOutputType> | number
          }
        }
      }
      restaurants: {
        payload: Prisma.$restaurantsPayload<ExtArgs>
        fields: Prisma.restaurantsFieldRefs
        operations: {
          findUnique: {
            args: Prisma.restaurantsFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$restaurantsPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.restaurantsFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$restaurantsPayload>
          }
          findFirst: {
            args: Prisma.restaurantsFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$restaurantsPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.restaurantsFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$restaurantsPayload>
          }
          findMany: {
            args: Prisma.restaurantsFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$restaurantsPayload>[]
          }
          delete: {
            args: Prisma.restaurantsDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$restaurantsPayload>
          }
          update: {
            args: Prisma.restaurantsUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$restaurantsPayload>
          }
          deleteMany: {
            args: Prisma.restaurantsDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.restaurantsUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.restaurantsUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$restaurantsPayload>[]
          }
          aggregate: {
            args: Prisma.RestaurantsAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateRestaurants>
          }
          groupBy: {
            args: Prisma.restaurantsGroupByArgs<ExtArgs>
            result: $Utils.Optional<RestaurantsGroupByOutputType>[]
          }
          count: {
            args: Prisma.restaurantsCountArgs<ExtArgs>
            result: $Utils.Optional<RestaurantsCountAggregateOutputType> | number
          }
        }
      }
      spatial_ref_sys: {
        payload: Prisma.$spatial_ref_sysPayload<ExtArgs>
        fields: Prisma.spatial_ref_sysFieldRefs
        operations: {
          findUnique: {
            args: Prisma.spatial_ref_sysFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$spatial_ref_sysPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.spatial_ref_sysFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$spatial_ref_sysPayload>
          }
          findFirst: {
            args: Prisma.spatial_ref_sysFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$spatial_ref_sysPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.spatial_ref_sysFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$spatial_ref_sysPayload>
          }
          findMany: {
            args: Prisma.spatial_ref_sysFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$spatial_ref_sysPayload>[]
          }
          create: {
            args: Prisma.spatial_ref_sysCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$spatial_ref_sysPayload>
          }
          createMany: {
            args: Prisma.spatial_ref_sysCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.spatial_ref_sysCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$spatial_ref_sysPayload>[]
          }
          delete: {
            args: Prisma.spatial_ref_sysDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$spatial_ref_sysPayload>
          }
          update: {
            args: Prisma.spatial_ref_sysUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$spatial_ref_sysPayload>
          }
          deleteMany: {
            args: Prisma.spatial_ref_sysDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.spatial_ref_sysUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.spatial_ref_sysUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$spatial_ref_sysPayload>[]
          }
          upsert: {
            args: Prisma.spatial_ref_sysUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$spatial_ref_sysPayload>
          }
          aggregate: {
            args: Prisma.Spatial_ref_sysAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateSpatial_ref_sys>
          }
          groupBy: {
            args: Prisma.spatial_ref_sysGroupByArgs<ExtArgs>
            result: $Utils.Optional<Spatial_ref_sysGroupByOutputType>[]
          }
          count: {
            args: Prisma.spatial_ref_sysCountArgs<ExtArgs>
            result: $Utils.Optional<Spatial_ref_sysCountAggregateOutputType> | number
          }
        }
      }
      users: {
        payload: Prisma.$usersPayload<ExtArgs>
        fields: Prisma.usersFieldRefs
        operations: {
          findUnique: {
            args: Prisma.usersFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$usersPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.usersFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$usersPayload>
          }
          findFirst: {
            args: Prisma.usersFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$usersPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.usersFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$usersPayload>
          }
          findMany: {
            args: Prisma.usersFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$usersPayload>[]
          }
          create: {
            args: Prisma.usersCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$usersPayload>
          }
          createMany: {
            args: Prisma.usersCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.usersCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$usersPayload>[]
          }
          delete: {
            args: Prisma.usersDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$usersPayload>
          }
          update: {
            args: Prisma.usersUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$usersPayload>
          }
          deleteMany: {
            args: Prisma.usersDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.usersUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.usersUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$usersPayload>[]
          }
          upsert: {
            args: Prisma.usersUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$usersPayload>
          }
          aggregate: {
            args: Prisma.UsersAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateUsers>
          }
          groupBy: {
            args: Prisma.usersGroupByArgs<ExtArgs>
            result: $Utils.Optional<UsersGroupByOutputType>[]
          }
          count: {
            args: Prisma.usersCountArgs<ExtArgs>
            result: $Utils.Optional<UsersCountAggregateOutputType> | number
          }
        }
      }
    }
  } & {
    other: {
      payload: any
      operations: {
        $executeRaw: {
          args: [query: TemplateStringsArray | Prisma.Sql, ...values: any[]],
          result: any
        }
        $executeRawUnsafe: {
          args: [query: string, ...values: any[]],
          result: any
        }
        $queryRaw: {
          args: [query: TemplateStringsArray | Prisma.Sql, ...values: any[]],
          result: any
        }
        $queryRawUnsafe: {
          args: [query: string, ...values: any[]],
          result: any
        }
      }
    }
  }
  export const defineExtension: $Extensions.ExtendsHook<"define", Prisma.TypeMapCb, $Extensions.DefaultArgs>
  export type DefaultPrismaClient = PrismaClient
  export type ErrorFormat = 'pretty' | 'colorless' | 'minimal'
  export interface PrismaClientOptions {
    /**
     * Overwrites the datasource url from your schema.prisma file
     */
    datasources?: Datasources
    /**
     * Overwrites the datasource url from your schema.prisma file
     */
    datasourceUrl?: string
    /**
     * @default "colorless"
     */
    errorFormat?: ErrorFormat
    /**
     * @example
     * ```
     * // Shorthand for `emit: 'stdout'`
     * log: ['query', 'info', 'warn', 'error']
     * 
     * // Emit as events only
     * log: [
     *   { emit: 'event', level: 'query' },
     *   { emit: 'event', level: 'info' },
     *   { emit: 'event', level: 'warn' }
     *   { emit: 'event', level: 'error' }
     * ]
     * 
     * / Emit as events and log to stdout
     * og: [
     *  { emit: 'stdout', level: 'query' },
     *  { emit: 'stdout', level: 'info' },
     *  { emit: 'stdout', level: 'warn' }
     *  { emit: 'stdout', level: 'error' }
     * 
     * ```
     * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/logging#the-log-option).
     */
    log?: (LogLevel | LogDefinition)[]
    /**
     * The default values for transactionOptions
     * maxWait ?= 2000
     * timeout ?= 5000
     */
    transactionOptions?: {
      maxWait?: number
      timeout?: number
      isolationLevel?: Prisma.TransactionIsolationLevel
    }
    /**
     * Global configuration for omitting model fields by default.
     * 
     * @example
     * ```
     * const prisma = new PrismaClient({
     *   omit: {
     *     user: {
     *       password: true
     *     }
     *   }
     * })
     * ```
     */
    omit?: Prisma.GlobalOmitConfig
  }
  export type GlobalOmitConfig = {
    dish_categories?: dish_categoriesOmit
    dish_category_variants?: dish_category_variantsOmit
    dish_likes?: dish_likesOmit
    dish_media?: dish_mediaOmit
    dish_reviews?: dish_reviewsOmit
    dishes?: dishesOmit
    payouts?: payoutsOmit
    restaurant_bids?: restaurant_bidsOmit
    restaurants?: restaurantsOmit
    spatial_ref_sys?: spatial_ref_sysOmit
    users?: usersOmit
  }

  /* Types for Logging */
  export type LogLevel = 'info' | 'query' | 'warn' | 'error'
  export type LogDefinition = {
    level: LogLevel
    emit: 'stdout' | 'event'
  }

  export type CheckIsLogLevel<T> = T extends LogLevel ? T : never;

  export type GetLogType<T> = CheckIsLogLevel<
    T extends LogDefinition ? T['level'] : T
  >;

  export type GetEvents<T extends any[]> = T extends Array<LogLevel | LogDefinition>
    ? GetLogType<T[number]>
    : never;

  export type QueryEvent = {
    timestamp: Date
    query: string
    params: string
    duration: number
    target: string
  }

  export type LogEvent = {
    timestamp: Date
    message: string
    target: string
  }
  /* End Types for Logging */


  export type PrismaAction =
    | 'findUnique'
    | 'findUniqueOrThrow'
    | 'findMany'
    | 'findFirst'
    | 'findFirstOrThrow'
    | 'create'
    | 'createMany'
    | 'createManyAndReturn'
    | 'update'
    | 'updateMany'
    | 'updateManyAndReturn'
    | 'upsert'
    | 'delete'
    | 'deleteMany'
    | 'executeRaw'
    | 'queryRaw'
    | 'aggregate'
    | 'count'
    | 'runCommandRaw'
    | 'findRaw'
    | 'groupBy'

  /**
   * These options are being passed into the middleware as "params"
   */
  export type MiddlewareParams = {
    model?: ModelName
    action: PrismaAction
    args: any
    dataPath: string[]
    runInTransaction: boolean
  }

  /**
   * The `T` type makes sure, that the `return proceed` is not forgotten in the middleware implementation
   */
  export type Middleware<T = any> = (
    params: MiddlewareParams,
    next: (params: MiddlewareParams) => $Utils.JsPromise<T>,
  ) => $Utils.JsPromise<T>

  // tested in getLogLevel.test.ts
  export function getLogLevel(log: Array<LogLevel | LogDefinition>): LogLevel | undefined;

  /**
   * `PrismaClient` proxy available in interactive transactions.
   */
  export type TransactionClient = Omit<Prisma.DefaultPrismaClient, runtime.ITXClientDenyList>

  export type Datasource = {
    url?: string
  }

  /**
   * Count Types
   */


  /**
   * Count Type Dish_categoriesCountOutputType
   */

  export type Dish_categoriesCountOutputType = {
    dish_category_variants: number
    dishes: number
  }

  export type Dish_categoriesCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    dish_category_variants?: boolean | Dish_categoriesCountOutputTypeCountDish_category_variantsArgs
    dishes?: boolean | Dish_categoriesCountOutputTypeCountDishesArgs
  }

  // Custom InputTypes
  /**
   * Dish_categoriesCountOutputType without action
   */
  export type Dish_categoriesCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Dish_categoriesCountOutputType
     */
    select?: Dish_categoriesCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * Dish_categoriesCountOutputType without action
   */
  export type Dish_categoriesCountOutputTypeCountDish_category_variantsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: dish_category_variantsWhereInput
  }

  /**
   * Dish_categoriesCountOutputType without action
   */
  export type Dish_categoriesCountOutputTypeCountDishesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: dishesWhereInput
  }


  /**
   * Count Type Dish_mediaCountOutputType
   */

  export type Dish_mediaCountOutputType = {
    dish_likes: number
    payouts: number
  }

  export type Dish_mediaCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    dish_likes?: boolean | Dish_mediaCountOutputTypeCountDish_likesArgs
    payouts?: boolean | Dish_mediaCountOutputTypeCountPayoutsArgs
  }

  // Custom InputTypes
  /**
   * Dish_mediaCountOutputType without action
   */
  export type Dish_mediaCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Dish_mediaCountOutputType
     */
    select?: Dish_mediaCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * Dish_mediaCountOutputType without action
   */
  export type Dish_mediaCountOutputTypeCountDish_likesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: dish_likesWhereInput
  }

  /**
   * Dish_mediaCountOutputType without action
   */
  export type Dish_mediaCountOutputTypeCountPayoutsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: payoutsWhereInput
  }


  /**
   * Count Type DishesCountOutputType
   */

  export type DishesCountOutputType = {
    dish_media: number
    dish_reviews: number
  }

  export type DishesCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    dish_media?: boolean | DishesCountOutputTypeCountDish_mediaArgs
    dish_reviews?: boolean | DishesCountOutputTypeCountDish_reviewsArgs
  }

  // Custom InputTypes
  /**
   * DishesCountOutputType without action
   */
  export type DishesCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the DishesCountOutputType
     */
    select?: DishesCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * DishesCountOutputType without action
   */
  export type DishesCountOutputTypeCountDish_mediaArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: dish_mediaWhereInput
  }

  /**
   * DishesCountOutputType without action
   */
  export type DishesCountOutputTypeCountDish_reviewsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: dish_reviewsWhereInput
  }


  /**
   * Count Type Restaurant_bidsCountOutputType
   */

  export type Restaurant_bidsCountOutputType = {
    payouts: number
  }

  export type Restaurant_bidsCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    payouts?: boolean | Restaurant_bidsCountOutputTypeCountPayoutsArgs
  }

  // Custom InputTypes
  /**
   * Restaurant_bidsCountOutputType without action
   */
  export type Restaurant_bidsCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Restaurant_bidsCountOutputType
     */
    select?: Restaurant_bidsCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * Restaurant_bidsCountOutputType without action
   */
  export type Restaurant_bidsCountOutputTypeCountPayoutsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: payoutsWhereInput
  }


  /**
   * Count Type RestaurantsCountOutputType
   */

  export type RestaurantsCountOutputType = {
    dishes: number
    restaurant_bids: number
  }

  export type RestaurantsCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    dishes?: boolean | RestaurantsCountOutputTypeCountDishesArgs
    restaurant_bids?: boolean | RestaurantsCountOutputTypeCountRestaurant_bidsArgs
  }

  // Custom InputTypes
  /**
   * RestaurantsCountOutputType without action
   */
  export type RestaurantsCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RestaurantsCountOutputType
     */
    select?: RestaurantsCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * RestaurantsCountOutputType without action
   */
  export type RestaurantsCountOutputTypeCountDishesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: dishesWhereInput
  }

  /**
   * RestaurantsCountOutputType without action
   */
  export type RestaurantsCountOutputTypeCountRestaurant_bidsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: restaurant_bidsWhereInput
  }


  /**
   * Count Type UsersCountOutputType
   */

  export type UsersCountOutputType = {
    dish_likes: number
    dish_media: number
    dish_reviews: number
    restaurant_bids: number
  }

  export type UsersCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    dish_likes?: boolean | UsersCountOutputTypeCountDish_likesArgs
    dish_media?: boolean | UsersCountOutputTypeCountDish_mediaArgs
    dish_reviews?: boolean | UsersCountOutputTypeCountDish_reviewsArgs
    restaurant_bids?: boolean | UsersCountOutputTypeCountRestaurant_bidsArgs
  }

  // Custom InputTypes
  /**
   * UsersCountOutputType without action
   */
  export type UsersCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UsersCountOutputType
     */
    select?: UsersCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * UsersCountOutputType without action
   */
  export type UsersCountOutputTypeCountDish_likesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: dish_likesWhereInput
  }

  /**
   * UsersCountOutputType without action
   */
  export type UsersCountOutputTypeCountDish_mediaArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: dish_mediaWhereInput
  }

  /**
   * UsersCountOutputType without action
   */
  export type UsersCountOutputTypeCountDish_reviewsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: dish_reviewsWhereInput
  }

  /**
   * UsersCountOutputType without action
   */
  export type UsersCountOutputTypeCountRestaurant_bidsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: restaurant_bidsWhereInput
  }


  /**
   * Models
   */

  /**
   * Model dish_categories
   */

  export type AggregateDish_categories = {
    _count: Dish_categoriesCountAggregateOutputType | null
    _avg: Dish_categoriesAvgAggregateOutputType | null
    _sum: Dish_categoriesSumAggregateOutputType | null
    _min: Dish_categoriesMinAggregateOutputType | null
    _max: Dish_categoriesMaxAggregateOutputType | null
  }

  export type Dish_categoriesAvgAggregateOutputType = {
    lock_no: number | null
  }

  export type Dish_categoriesSumAggregateOutputType = {
    lock_no: number | null
  }

  export type Dish_categoriesMinAggregateOutputType = {
    id: string | null
    label_en: string | null
    image_url: string | null
    created_at: Date | null
    updated_at: Date | null
    lock_no: number | null
  }

  export type Dish_categoriesMaxAggregateOutputType = {
    id: string | null
    label_en: string | null
    image_url: string | null
    created_at: Date | null
    updated_at: Date | null
    lock_no: number | null
  }

  export type Dish_categoriesCountAggregateOutputType = {
    id: number
    label_en: number
    labels: number
    image_url: number
    origin: number
    cuisine: number
    tags: number
    created_at: number
    updated_at: number
    lock_no: number
    _all: number
  }


  export type Dish_categoriesAvgAggregateInputType = {
    lock_no?: true
  }

  export type Dish_categoriesSumAggregateInputType = {
    lock_no?: true
  }

  export type Dish_categoriesMinAggregateInputType = {
    id?: true
    label_en?: true
    image_url?: true
    created_at?: true
    updated_at?: true
    lock_no?: true
  }

  export type Dish_categoriesMaxAggregateInputType = {
    id?: true
    label_en?: true
    image_url?: true
    created_at?: true
    updated_at?: true
    lock_no?: true
  }

  export type Dish_categoriesCountAggregateInputType = {
    id?: true
    label_en?: true
    labels?: true
    image_url?: true
    origin?: true
    cuisine?: true
    tags?: true
    created_at?: true
    updated_at?: true
    lock_no?: true
    _all?: true
  }

  export type Dish_categoriesAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which dish_categories to aggregate.
     */
    where?: dish_categoriesWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of dish_categories to fetch.
     */
    orderBy?: dish_categoriesOrderByWithRelationInput | dish_categoriesOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: dish_categoriesWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` dish_categories from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` dish_categories.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned dish_categories
    **/
    _count?: true | Dish_categoriesCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: Dish_categoriesAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: Dish_categoriesSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: Dish_categoriesMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: Dish_categoriesMaxAggregateInputType
  }

  export type GetDish_categoriesAggregateType<T extends Dish_categoriesAggregateArgs> = {
        [P in keyof T & keyof AggregateDish_categories]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateDish_categories[P]>
      : GetScalarType<T[P], AggregateDish_categories[P]>
  }




  export type dish_categoriesGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: dish_categoriesWhereInput
    orderBy?: dish_categoriesOrderByWithAggregationInput | dish_categoriesOrderByWithAggregationInput[]
    by: Dish_categoriesScalarFieldEnum[] | Dish_categoriesScalarFieldEnum
    having?: dish_categoriesScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: Dish_categoriesCountAggregateInputType | true
    _avg?: Dish_categoriesAvgAggregateInputType
    _sum?: Dish_categoriesSumAggregateInputType
    _min?: Dish_categoriesMinAggregateInputType
    _max?: Dish_categoriesMaxAggregateInputType
  }

  export type Dish_categoriesGroupByOutputType = {
    id: string
    label_en: string
    labels: JsonValue
    image_url: string
    origin: string[]
    cuisine: string[]
    tags: string[]
    created_at: Date
    updated_at: Date
    lock_no: number
    _count: Dish_categoriesCountAggregateOutputType | null
    _avg: Dish_categoriesAvgAggregateOutputType | null
    _sum: Dish_categoriesSumAggregateOutputType | null
    _min: Dish_categoriesMinAggregateOutputType | null
    _max: Dish_categoriesMaxAggregateOutputType | null
  }

  type GetDish_categoriesGroupByPayload<T extends dish_categoriesGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<Dish_categoriesGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof Dish_categoriesGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], Dish_categoriesGroupByOutputType[P]>
            : GetScalarType<T[P], Dish_categoriesGroupByOutputType[P]>
        }
      >
    >


  export type dish_categoriesSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    label_en?: boolean
    labels?: boolean
    image_url?: boolean
    origin?: boolean
    cuisine?: boolean
    tags?: boolean
    created_at?: boolean
    updated_at?: boolean
    lock_no?: boolean
    dish_category_variants?: boolean | dish_categories$dish_category_variantsArgs<ExtArgs>
    dishes?: boolean | dish_categories$dishesArgs<ExtArgs>
    _count?: boolean | Dish_categoriesCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["dish_categories"]>

  export type dish_categoriesSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    label_en?: boolean
    labels?: boolean
    image_url?: boolean
    origin?: boolean
    cuisine?: boolean
    tags?: boolean
    created_at?: boolean
    updated_at?: boolean
    lock_no?: boolean
  }, ExtArgs["result"]["dish_categories"]>

  export type dish_categoriesSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    label_en?: boolean
    labels?: boolean
    image_url?: boolean
    origin?: boolean
    cuisine?: boolean
    tags?: boolean
    created_at?: boolean
    updated_at?: boolean
    lock_no?: boolean
  }, ExtArgs["result"]["dish_categories"]>

  export type dish_categoriesSelectScalar = {
    id?: boolean
    label_en?: boolean
    labels?: boolean
    image_url?: boolean
    origin?: boolean
    cuisine?: boolean
    tags?: boolean
    created_at?: boolean
    updated_at?: boolean
    lock_no?: boolean
  }

  export type dish_categoriesOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "label_en" | "labels" | "image_url" | "origin" | "cuisine" | "tags" | "created_at" | "updated_at" | "lock_no", ExtArgs["result"]["dish_categories"]>
  export type dish_categoriesInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    dish_category_variants?: boolean | dish_categories$dish_category_variantsArgs<ExtArgs>
    dishes?: boolean | dish_categories$dishesArgs<ExtArgs>
    _count?: boolean | Dish_categoriesCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type dish_categoriesIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}
  export type dish_categoriesIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}

  export type $dish_categoriesPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "dish_categories"
    objects: {
      dish_category_variants: Prisma.$dish_category_variantsPayload<ExtArgs>[]
      dishes: Prisma.$dishesPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      label_en: string
      labels: Prisma.JsonValue
      image_url: string
      origin: string[]
      cuisine: string[]
      tags: string[]
      created_at: Date
      updated_at: Date
      lock_no: number
    }, ExtArgs["result"]["dish_categories"]>
    composites: {}
  }

  type dish_categoriesGetPayload<S extends boolean | null | undefined | dish_categoriesDefaultArgs> = $Result.GetResult<Prisma.$dish_categoriesPayload, S>

  type dish_categoriesCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<dish_categoriesFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: Dish_categoriesCountAggregateInputType | true
    }

  export interface dish_categoriesDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['dish_categories'], meta: { name: 'dish_categories' } }
    /**
     * Find zero or one Dish_categories that matches the filter.
     * @param {dish_categoriesFindUniqueArgs} args - Arguments to find a Dish_categories
     * @example
     * // Get one Dish_categories
     * const dish_categories = await prisma.dish_categories.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends dish_categoriesFindUniqueArgs>(args: SelectSubset<T, dish_categoriesFindUniqueArgs<ExtArgs>>): Prisma__dish_categoriesClient<$Result.GetResult<Prisma.$dish_categoriesPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one Dish_categories that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {dish_categoriesFindUniqueOrThrowArgs} args - Arguments to find a Dish_categories
     * @example
     * // Get one Dish_categories
     * const dish_categories = await prisma.dish_categories.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends dish_categoriesFindUniqueOrThrowArgs>(args: SelectSubset<T, dish_categoriesFindUniqueOrThrowArgs<ExtArgs>>): Prisma__dish_categoriesClient<$Result.GetResult<Prisma.$dish_categoriesPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Dish_categories that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {dish_categoriesFindFirstArgs} args - Arguments to find a Dish_categories
     * @example
     * // Get one Dish_categories
     * const dish_categories = await prisma.dish_categories.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends dish_categoriesFindFirstArgs>(args?: SelectSubset<T, dish_categoriesFindFirstArgs<ExtArgs>>): Prisma__dish_categoriesClient<$Result.GetResult<Prisma.$dish_categoriesPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Dish_categories that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {dish_categoriesFindFirstOrThrowArgs} args - Arguments to find a Dish_categories
     * @example
     * // Get one Dish_categories
     * const dish_categories = await prisma.dish_categories.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends dish_categoriesFindFirstOrThrowArgs>(args?: SelectSubset<T, dish_categoriesFindFirstOrThrowArgs<ExtArgs>>): Prisma__dish_categoriesClient<$Result.GetResult<Prisma.$dish_categoriesPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more Dish_categories that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {dish_categoriesFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Dish_categories
     * const dish_categories = await prisma.dish_categories.findMany()
     * 
     * // Get first 10 Dish_categories
     * const dish_categories = await prisma.dish_categories.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const dish_categoriesWithIdOnly = await prisma.dish_categories.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends dish_categoriesFindManyArgs>(args?: SelectSubset<T, dish_categoriesFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$dish_categoriesPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a Dish_categories.
     * @param {dish_categoriesCreateArgs} args - Arguments to create a Dish_categories.
     * @example
     * // Create one Dish_categories
     * const Dish_categories = await prisma.dish_categories.create({
     *   data: {
     *     // ... data to create a Dish_categories
     *   }
     * })
     * 
     */
    create<T extends dish_categoriesCreateArgs>(args: SelectSubset<T, dish_categoriesCreateArgs<ExtArgs>>): Prisma__dish_categoriesClient<$Result.GetResult<Prisma.$dish_categoriesPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many Dish_categories.
     * @param {dish_categoriesCreateManyArgs} args - Arguments to create many Dish_categories.
     * @example
     * // Create many Dish_categories
     * const dish_categories = await prisma.dish_categories.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends dish_categoriesCreateManyArgs>(args?: SelectSubset<T, dish_categoriesCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Dish_categories and returns the data saved in the database.
     * @param {dish_categoriesCreateManyAndReturnArgs} args - Arguments to create many Dish_categories.
     * @example
     * // Create many Dish_categories
     * const dish_categories = await prisma.dish_categories.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Dish_categories and only return the `id`
     * const dish_categoriesWithIdOnly = await prisma.dish_categories.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends dish_categoriesCreateManyAndReturnArgs>(args?: SelectSubset<T, dish_categoriesCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$dish_categoriesPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a Dish_categories.
     * @param {dish_categoriesDeleteArgs} args - Arguments to delete one Dish_categories.
     * @example
     * // Delete one Dish_categories
     * const Dish_categories = await prisma.dish_categories.delete({
     *   where: {
     *     // ... filter to delete one Dish_categories
     *   }
     * })
     * 
     */
    delete<T extends dish_categoriesDeleteArgs>(args: SelectSubset<T, dish_categoriesDeleteArgs<ExtArgs>>): Prisma__dish_categoriesClient<$Result.GetResult<Prisma.$dish_categoriesPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one Dish_categories.
     * @param {dish_categoriesUpdateArgs} args - Arguments to update one Dish_categories.
     * @example
     * // Update one Dish_categories
     * const dish_categories = await prisma.dish_categories.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends dish_categoriesUpdateArgs>(args: SelectSubset<T, dish_categoriesUpdateArgs<ExtArgs>>): Prisma__dish_categoriesClient<$Result.GetResult<Prisma.$dish_categoriesPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more Dish_categories.
     * @param {dish_categoriesDeleteManyArgs} args - Arguments to filter Dish_categories to delete.
     * @example
     * // Delete a few Dish_categories
     * const { count } = await prisma.dish_categories.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends dish_categoriesDeleteManyArgs>(args?: SelectSubset<T, dish_categoriesDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Dish_categories.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {dish_categoriesUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Dish_categories
     * const dish_categories = await prisma.dish_categories.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends dish_categoriesUpdateManyArgs>(args: SelectSubset<T, dish_categoriesUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Dish_categories and returns the data updated in the database.
     * @param {dish_categoriesUpdateManyAndReturnArgs} args - Arguments to update many Dish_categories.
     * @example
     * // Update many Dish_categories
     * const dish_categories = await prisma.dish_categories.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more Dish_categories and only return the `id`
     * const dish_categoriesWithIdOnly = await prisma.dish_categories.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends dish_categoriesUpdateManyAndReturnArgs>(args: SelectSubset<T, dish_categoriesUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$dish_categoriesPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one Dish_categories.
     * @param {dish_categoriesUpsertArgs} args - Arguments to update or create a Dish_categories.
     * @example
     * // Update or create a Dish_categories
     * const dish_categories = await prisma.dish_categories.upsert({
     *   create: {
     *     // ... data to create a Dish_categories
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Dish_categories we want to update
     *   }
     * })
     */
    upsert<T extends dish_categoriesUpsertArgs>(args: SelectSubset<T, dish_categoriesUpsertArgs<ExtArgs>>): Prisma__dish_categoriesClient<$Result.GetResult<Prisma.$dish_categoriesPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of Dish_categories.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {dish_categoriesCountArgs} args - Arguments to filter Dish_categories to count.
     * @example
     * // Count the number of Dish_categories
     * const count = await prisma.dish_categories.count({
     *   where: {
     *     // ... the filter for the Dish_categories we want to count
     *   }
     * })
    **/
    count<T extends dish_categoriesCountArgs>(
      args?: Subset<T, dish_categoriesCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], Dish_categoriesCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Dish_categories.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Dish_categoriesAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends Dish_categoriesAggregateArgs>(args: Subset<T, Dish_categoriesAggregateArgs>): Prisma.PrismaPromise<GetDish_categoriesAggregateType<T>>

    /**
     * Group by Dish_categories.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {dish_categoriesGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends dish_categoriesGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: dish_categoriesGroupByArgs['orderBy'] }
        : { orderBy?: dish_categoriesGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, dish_categoriesGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetDish_categoriesGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the dish_categories model
   */
  readonly fields: dish_categoriesFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for dish_categories.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__dish_categoriesClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    dish_category_variants<T extends dish_categories$dish_category_variantsArgs<ExtArgs> = {}>(args?: Subset<T, dish_categories$dish_category_variantsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$dish_category_variantsPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    dishes<T extends dish_categories$dishesArgs<ExtArgs> = {}>(args?: Subset<T, dish_categories$dishesArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$dishesPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the dish_categories model
   */
  interface dish_categoriesFieldRefs {
    readonly id: FieldRef<"dish_categories", 'String'>
    readonly label_en: FieldRef<"dish_categories", 'String'>
    readonly labels: FieldRef<"dish_categories", 'Json'>
    readonly image_url: FieldRef<"dish_categories", 'String'>
    readonly origin: FieldRef<"dish_categories", 'String[]'>
    readonly cuisine: FieldRef<"dish_categories", 'String[]'>
    readonly tags: FieldRef<"dish_categories", 'String[]'>
    readonly created_at: FieldRef<"dish_categories", 'DateTime'>
    readonly updated_at: FieldRef<"dish_categories", 'DateTime'>
    readonly lock_no: FieldRef<"dish_categories", 'Int'>
  }
    

  // Custom InputTypes
  /**
   * dish_categories findUnique
   */
  export type dish_categoriesFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_categories
     */
    select?: dish_categoriesSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_categories
     */
    omit?: dish_categoriesOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_categoriesInclude<ExtArgs> | null
    /**
     * Filter, which dish_categories to fetch.
     */
    where: dish_categoriesWhereUniqueInput
  }

  /**
   * dish_categories findUniqueOrThrow
   */
  export type dish_categoriesFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_categories
     */
    select?: dish_categoriesSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_categories
     */
    omit?: dish_categoriesOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_categoriesInclude<ExtArgs> | null
    /**
     * Filter, which dish_categories to fetch.
     */
    where: dish_categoriesWhereUniqueInput
  }

  /**
   * dish_categories findFirst
   */
  export type dish_categoriesFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_categories
     */
    select?: dish_categoriesSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_categories
     */
    omit?: dish_categoriesOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_categoriesInclude<ExtArgs> | null
    /**
     * Filter, which dish_categories to fetch.
     */
    where?: dish_categoriesWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of dish_categories to fetch.
     */
    orderBy?: dish_categoriesOrderByWithRelationInput | dish_categoriesOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for dish_categories.
     */
    cursor?: dish_categoriesWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` dish_categories from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` dish_categories.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of dish_categories.
     */
    distinct?: Dish_categoriesScalarFieldEnum | Dish_categoriesScalarFieldEnum[]
  }

  /**
   * dish_categories findFirstOrThrow
   */
  export type dish_categoriesFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_categories
     */
    select?: dish_categoriesSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_categories
     */
    omit?: dish_categoriesOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_categoriesInclude<ExtArgs> | null
    /**
     * Filter, which dish_categories to fetch.
     */
    where?: dish_categoriesWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of dish_categories to fetch.
     */
    orderBy?: dish_categoriesOrderByWithRelationInput | dish_categoriesOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for dish_categories.
     */
    cursor?: dish_categoriesWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` dish_categories from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` dish_categories.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of dish_categories.
     */
    distinct?: Dish_categoriesScalarFieldEnum | Dish_categoriesScalarFieldEnum[]
  }

  /**
   * dish_categories findMany
   */
  export type dish_categoriesFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_categories
     */
    select?: dish_categoriesSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_categories
     */
    omit?: dish_categoriesOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_categoriesInclude<ExtArgs> | null
    /**
     * Filter, which dish_categories to fetch.
     */
    where?: dish_categoriesWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of dish_categories to fetch.
     */
    orderBy?: dish_categoriesOrderByWithRelationInput | dish_categoriesOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing dish_categories.
     */
    cursor?: dish_categoriesWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` dish_categories from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` dish_categories.
     */
    skip?: number
    distinct?: Dish_categoriesScalarFieldEnum | Dish_categoriesScalarFieldEnum[]
  }

  /**
   * dish_categories create
   */
  export type dish_categoriesCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_categories
     */
    select?: dish_categoriesSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_categories
     */
    omit?: dish_categoriesOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_categoriesInclude<ExtArgs> | null
    /**
     * The data needed to create a dish_categories.
     */
    data: XOR<dish_categoriesCreateInput, dish_categoriesUncheckedCreateInput>
  }

  /**
   * dish_categories createMany
   */
  export type dish_categoriesCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many dish_categories.
     */
    data: dish_categoriesCreateManyInput | dish_categoriesCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * dish_categories createManyAndReturn
   */
  export type dish_categoriesCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_categories
     */
    select?: dish_categoriesSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the dish_categories
     */
    omit?: dish_categoriesOmit<ExtArgs> | null
    /**
     * The data used to create many dish_categories.
     */
    data: dish_categoriesCreateManyInput | dish_categoriesCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * dish_categories update
   */
  export type dish_categoriesUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_categories
     */
    select?: dish_categoriesSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_categories
     */
    omit?: dish_categoriesOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_categoriesInclude<ExtArgs> | null
    /**
     * The data needed to update a dish_categories.
     */
    data: XOR<dish_categoriesUpdateInput, dish_categoriesUncheckedUpdateInput>
    /**
     * Choose, which dish_categories to update.
     */
    where: dish_categoriesWhereUniqueInput
  }

  /**
   * dish_categories updateMany
   */
  export type dish_categoriesUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update dish_categories.
     */
    data: XOR<dish_categoriesUpdateManyMutationInput, dish_categoriesUncheckedUpdateManyInput>
    /**
     * Filter which dish_categories to update
     */
    where?: dish_categoriesWhereInput
    /**
     * Limit how many dish_categories to update.
     */
    limit?: number
  }

  /**
   * dish_categories updateManyAndReturn
   */
  export type dish_categoriesUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_categories
     */
    select?: dish_categoriesSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the dish_categories
     */
    omit?: dish_categoriesOmit<ExtArgs> | null
    /**
     * The data used to update dish_categories.
     */
    data: XOR<dish_categoriesUpdateManyMutationInput, dish_categoriesUncheckedUpdateManyInput>
    /**
     * Filter which dish_categories to update
     */
    where?: dish_categoriesWhereInput
    /**
     * Limit how many dish_categories to update.
     */
    limit?: number
  }

  /**
   * dish_categories upsert
   */
  export type dish_categoriesUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_categories
     */
    select?: dish_categoriesSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_categories
     */
    omit?: dish_categoriesOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_categoriesInclude<ExtArgs> | null
    /**
     * The filter to search for the dish_categories to update in case it exists.
     */
    where: dish_categoriesWhereUniqueInput
    /**
     * In case the dish_categories found by the `where` argument doesn't exist, create a new dish_categories with this data.
     */
    create: XOR<dish_categoriesCreateInput, dish_categoriesUncheckedCreateInput>
    /**
     * In case the dish_categories was found with the provided `where` argument, update it with this data.
     */
    update: XOR<dish_categoriesUpdateInput, dish_categoriesUncheckedUpdateInput>
  }

  /**
   * dish_categories delete
   */
  export type dish_categoriesDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_categories
     */
    select?: dish_categoriesSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_categories
     */
    omit?: dish_categoriesOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_categoriesInclude<ExtArgs> | null
    /**
     * Filter which dish_categories to delete.
     */
    where: dish_categoriesWhereUniqueInput
  }

  /**
   * dish_categories deleteMany
   */
  export type dish_categoriesDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which dish_categories to delete
     */
    where?: dish_categoriesWhereInput
    /**
     * Limit how many dish_categories to delete.
     */
    limit?: number
  }

  /**
   * dish_categories.dish_category_variants
   */
  export type dish_categories$dish_category_variantsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_category_variants
     */
    select?: dish_category_variantsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_category_variants
     */
    omit?: dish_category_variantsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_category_variantsInclude<ExtArgs> | null
    where?: dish_category_variantsWhereInput
    orderBy?: dish_category_variantsOrderByWithRelationInput | dish_category_variantsOrderByWithRelationInput[]
    cursor?: dish_category_variantsWhereUniqueInput
    take?: number
    skip?: number
    distinct?: Dish_category_variantsScalarFieldEnum | Dish_category_variantsScalarFieldEnum[]
  }

  /**
   * dish_categories.dishes
   */
  export type dish_categories$dishesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dishes
     */
    select?: dishesSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dishes
     */
    omit?: dishesOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dishesInclude<ExtArgs> | null
    where?: dishesWhereInput
    orderBy?: dishesOrderByWithRelationInput | dishesOrderByWithRelationInput[]
    cursor?: dishesWhereUniqueInput
    take?: number
    skip?: number
    distinct?: DishesScalarFieldEnum | DishesScalarFieldEnum[]
  }

  /**
   * dish_categories without action
   */
  export type dish_categoriesDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_categories
     */
    select?: dish_categoriesSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_categories
     */
    omit?: dish_categoriesOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_categoriesInclude<ExtArgs> | null
  }


  /**
   * Model dish_category_variants
   */

  export type AggregateDish_category_variants = {
    _count: Dish_category_variantsCountAggregateOutputType | null
    _min: Dish_category_variantsMinAggregateOutputType | null
    _max: Dish_category_variantsMaxAggregateOutputType | null
  }

  export type Dish_category_variantsMinAggregateOutputType = {
    id: string | null
    dish_category_id: string | null
    surface_form: string | null
    source: string | null
    created_at: Date | null
  }

  export type Dish_category_variantsMaxAggregateOutputType = {
    id: string | null
    dish_category_id: string | null
    surface_form: string | null
    source: string | null
    created_at: Date | null
  }

  export type Dish_category_variantsCountAggregateOutputType = {
    id: number
    dish_category_id: number
    surface_form: number
    source: number
    created_at: number
    _all: number
  }


  export type Dish_category_variantsMinAggregateInputType = {
    id?: true
    dish_category_id?: true
    surface_form?: true
    source?: true
    created_at?: true
  }

  export type Dish_category_variantsMaxAggregateInputType = {
    id?: true
    dish_category_id?: true
    surface_form?: true
    source?: true
    created_at?: true
  }

  export type Dish_category_variantsCountAggregateInputType = {
    id?: true
    dish_category_id?: true
    surface_form?: true
    source?: true
    created_at?: true
    _all?: true
  }

  export type Dish_category_variantsAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which dish_category_variants to aggregate.
     */
    where?: dish_category_variantsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of dish_category_variants to fetch.
     */
    orderBy?: dish_category_variantsOrderByWithRelationInput | dish_category_variantsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: dish_category_variantsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` dish_category_variants from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` dish_category_variants.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned dish_category_variants
    **/
    _count?: true | Dish_category_variantsCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: Dish_category_variantsMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: Dish_category_variantsMaxAggregateInputType
  }

  export type GetDish_category_variantsAggregateType<T extends Dish_category_variantsAggregateArgs> = {
        [P in keyof T & keyof AggregateDish_category_variants]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateDish_category_variants[P]>
      : GetScalarType<T[P], AggregateDish_category_variants[P]>
  }




  export type dish_category_variantsGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: dish_category_variantsWhereInput
    orderBy?: dish_category_variantsOrderByWithAggregationInput | dish_category_variantsOrderByWithAggregationInput[]
    by: Dish_category_variantsScalarFieldEnum[] | Dish_category_variantsScalarFieldEnum
    having?: dish_category_variantsScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: Dish_category_variantsCountAggregateInputType | true
    _min?: Dish_category_variantsMinAggregateInputType
    _max?: Dish_category_variantsMaxAggregateInputType
  }

  export type Dish_category_variantsGroupByOutputType = {
    id: string
    dish_category_id: string
    surface_form: string
    source: string | null
    created_at: Date
    _count: Dish_category_variantsCountAggregateOutputType | null
    _min: Dish_category_variantsMinAggregateOutputType | null
    _max: Dish_category_variantsMaxAggregateOutputType | null
  }

  type GetDish_category_variantsGroupByPayload<T extends dish_category_variantsGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<Dish_category_variantsGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof Dish_category_variantsGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], Dish_category_variantsGroupByOutputType[P]>
            : GetScalarType<T[P], Dish_category_variantsGroupByOutputType[P]>
        }
      >
    >


  export type dish_category_variantsSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    dish_category_id?: boolean
    surface_form?: boolean
    source?: boolean
    created_at?: boolean
    dish_categories?: boolean | dish_categoriesDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["dish_category_variants"]>

  export type dish_category_variantsSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    dish_category_id?: boolean
    surface_form?: boolean
    source?: boolean
    created_at?: boolean
    dish_categories?: boolean | dish_categoriesDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["dish_category_variants"]>

  export type dish_category_variantsSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    dish_category_id?: boolean
    surface_form?: boolean
    source?: boolean
    created_at?: boolean
    dish_categories?: boolean | dish_categoriesDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["dish_category_variants"]>

  export type dish_category_variantsSelectScalar = {
    id?: boolean
    dish_category_id?: boolean
    surface_form?: boolean
    source?: boolean
    created_at?: boolean
  }

  export type dish_category_variantsOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "dish_category_id" | "surface_form" | "source" | "created_at", ExtArgs["result"]["dish_category_variants"]>
  export type dish_category_variantsInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    dish_categories?: boolean | dish_categoriesDefaultArgs<ExtArgs>
  }
  export type dish_category_variantsIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    dish_categories?: boolean | dish_categoriesDefaultArgs<ExtArgs>
  }
  export type dish_category_variantsIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    dish_categories?: boolean | dish_categoriesDefaultArgs<ExtArgs>
  }

  export type $dish_category_variantsPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "dish_category_variants"
    objects: {
      dish_categories: Prisma.$dish_categoriesPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      dish_category_id: string
      surface_form: string
      source: string | null
      created_at: Date
    }, ExtArgs["result"]["dish_category_variants"]>
    composites: {}
  }

  type dish_category_variantsGetPayload<S extends boolean | null | undefined | dish_category_variantsDefaultArgs> = $Result.GetResult<Prisma.$dish_category_variantsPayload, S>

  type dish_category_variantsCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<dish_category_variantsFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: Dish_category_variantsCountAggregateInputType | true
    }

  export interface dish_category_variantsDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['dish_category_variants'], meta: { name: 'dish_category_variants' } }
    /**
     * Find zero or one Dish_category_variants that matches the filter.
     * @param {dish_category_variantsFindUniqueArgs} args - Arguments to find a Dish_category_variants
     * @example
     * // Get one Dish_category_variants
     * const dish_category_variants = await prisma.dish_category_variants.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends dish_category_variantsFindUniqueArgs>(args: SelectSubset<T, dish_category_variantsFindUniqueArgs<ExtArgs>>): Prisma__dish_category_variantsClient<$Result.GetResult<Prisma.$dish_category_variantsPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one Dish_category_variants that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {dish_category_variantsFindUniqueOrThrowArgs} args - Arguments to find a Dish_category_variants
     * @example
     * // Get one Dish_category_variants
     * const dish_category_variants = await prisma.dish_category_variants.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends dish_category_variantsFindUniqueOrThrowArgs>(args: SelectSubset<T, dish_category_variantsFindUniqueOrThrowArgs<ExtArgs>>): Prisma__dish_category_variantsClient<$Result.GetResult<Prisma.$dish_category_variantsPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Dish_category_variants that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {dish_category_variantsFindFirstArgs} args - Arguments to find a Dish_category_variants
     * @example
     * // Get one Dish_category_variants
     * const dish_category_variants = await prisma.dish_category_variants.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends dish_category_variantsFindFirstArgs>(args?: SelectSubset<T, dish_category_variantsFindFirstArgs<ExtArgs>>): Prisma__dish_category_variantsClient<$Result.GetResult<Prisma.$dish_category_variantsPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Dish_category_variants that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {dish_category_variantsFindFirstOrThrowArgs} args - Arguments to find a Dish_category_variants
     * @example
     * // Get one Dish_category_variants
     * const dish_category_variants = await prisma.dish_category_variants.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends dish_category_variantsFindFirstOrThrowArgs>(args?: SelectSubset<T, dish_category_variantsFindFirstOrThrowArgs<ExtArgs>>): Prisma__dish_category_variantsClient<$Result.GetResult<Prisma.$dish_category_variantsPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more Dish_category_variants that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {dish_category_variantsFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Dish_category_variants
     * const dish_category_variants = await prisma.dish_category_variants.findMany()
     * 
     * // Get first 10 Dish_category_variants
     * const dish_category_variants = await prisma.dish_category_variants.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const dish_category_variantsWithIdOnly = await prisma.dish_category_variants.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends dish_category_variantsFindManyArgs>(args?: SelectSubset<T, dish_category_variantsFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$dish_category_variantsPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a Dish_category_variants.
     * @param {dish_category_variantsCreateArgs} args - Arguments to create a Dish_category_variants.
     * @example
     * // Create one Dish_category_variants
     * const Dish_category_variants = await prisma.dish_category_variants.create({
     *   data: {
     *     // ... data to create a Dish_category_variants
     *   }
     * })
     * 
     */
    create<T extends dish_category_variantsCreateArgs>(args: SelectSubset<T, dish_category_variantsCreateArgs<ExtArgs>>): Prisma__dish_category_variantsClient<$Result.GetResult<Prisma.$dish_category_variantsPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many Dish_category_variants.
     * @param {dish_category_variantsCreateManyArgs} args - Arguments to create many Dish_category_variants.
     * @example
     * // Create many Dish_category_variants
     * const dish_category_variants = await prisma.dish_category_variants.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends dish_category_variantsCreateManyArgs>(args?: SelectSubset<T, dish_category_variantsCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Dish_category_variants and returns the data saved in the database.
     * @param {dish_category_variantsCreateManyAndReturnArgs} args - Arguments to create many Dish_category_variants.
     * @example
     * // Create many Dish_category_variants
     * const dish_category_variants = await prisma.dish_category_variants.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Dish_category_variants and only return the `id`
     * const dish_category_variantsWithIdOnly = await prisma.dish_category_variants.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends dish_category_variantsCreateManyAndReturnArgs>(args?: SelectSubset<T, dish_category_variantsCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$dish_category_variantsPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a Dish_category_variants.
     * @param {dish_category_variantsDeleteArgs} args - Arguments to delete one Dish_category_variants.
     * @example
     * // Delete one Dish_category_variants
     * const Dish_category_variants = await prisma.dish_category_variants.delete({
     *   where: {
     *     // ... filter to delete one Dish_category_variants
     *   }
     * })
     * 
     */
    delete<T extends dish_category_variantsDeleteArgs>(args: SelectSubset<T, dish_category_variantsDeleteArgs<ExtArgs>>): Prisma__dish_category_variantsClient<$Result.GetResult<Prisma.$dish_category_variantsPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one Dish_category_variants.
     * @param {dish_category_variantsUpdateArgs} args - Arguments to update one Dish_category_variants.
     * @example
     * // Update one Dish_category_variants
     * const dish_category_variants = await prisma.dish_category_variants.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends dish_category_variantsUpdateArgs>(args: SelectSubset<T, dish_category_variantsUpdateArgs<ExtArgs>>): Prisma__dish_category_variantsClient<$Result.GetResult<Prisma.$dish_category_variantsPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more Dish_category_variants.
     * @param {dish_category_variantsDeleteManyArgs} args - Arguments to filter Dish_category_variants to delete.
     * @example
     * // Delete a few Dish_category_variants
     * const { count } = await prisma.dish_category_variants.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends dish_category_variantsDeleteManyArgs>(args?: SelectSubset<T, dish_category_variantsDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Dish_category_variants.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {dish_category_variantsUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Dish_category_variants
     * const dish_category_variants = await prisma.dish_category_variants.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends dish_category_variantsUpdateManyArgs>(args: SelectSubset<T, dish_category_variantsUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Dish_category_variants and returns the data updated in the database.
     * @param {dish_category_variantsUpdateManyAndReturnArgs} args - Arguments to update many Dish_category_variants.
     * @example
     * // Update many Dish_category_variants
     * const dish_category_variants = await prisma.dish_category_variants.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more Dish_category_variants and only return the `id`
     * const dish_category_variantsWithIdOnly = await prisma.dish_category_variants.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends dish_category_variantsUpdateManyAndReturnArgs>(args: SelectSubset<T, dish_category_variantsUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$dish_category_variantsPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one Dish_category_variants.
     * @param {dish_category_variantsUpsertArgs} args - Arguments to update or create a Dish_category_variants.
     * @example
     * // Update or create a Dish_category_variants
     * const dish_category_variants = await prisma.dish_category_variants.upsert({
     *   create: {
     *     // ... data to create a Dish_category_variants
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Dish_category_variants we want to update
     *   }
     * })
     */
    upsert<T extends dish_category_variantsUpsertArgs>(args: SelectSubset<T, dish_category_variantsUpsertArgs<ExtArgs>>): Prisma__dish_category_variantsClient<$Result.GetResult<Prisma.$dish_category_variantsPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of Dish_category_variants.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {dish_category_variantsCountArgs} args - Arguments to filter Dish_category_variants to count.
     * @example
     * // Count the number of Dish_category_variants
     * const count = await prisma.dish_category_variants.count({
     *   where: {
     *     // ... the filter for the Dish_category_variants we want to count
     *   }
     * })
    **/
    count<T extends dish_category_variantsCountArgs>(
      args?: Subset<T, dish_category_variantsCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], Dish_category_variantsCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Dish_category_variants.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Dish_category_variantsAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends Dish_category_variantsAggregateArgs>(args: Subset<T, Dish_category_variantsAggregateArgs>): Prisma.PrismaPromise<GetDish_category_variantsAggregateType<T>>

    /**
     * Group by Dish_category_variants.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {dish_category_variantsGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends dish_category_variantsGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: dish_category_variantsGroupByArgs['orderBy'] }
        : { orderBy?: dish_category_variantsGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, dish_category_variantsGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetDish_category_variantsGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the dish_category_variants model
   */
  readonly fields: dish_category_variantsFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for dish_category_variants.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__dish_category_variantsClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    dish_categories<T extends dish_categoriesDefaultArgs<ExtArgs> = {}>(args?: Subset<T, dish_categoriesDefaultArgs<ExtArgs>>): Prisma__dish_categoriesClient<$Result.GetResult<Prisma.$dish_categoriesPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the dish_category_variants model
   */
  interface dish_category_variantsFieldRefs {
    readonly id: FieldRef<"dish_category_variants", 'String'>
    readonly dish_category_id: FieldRef<"dish_category_variants", 'String'>
    readonly surface_form: FieldRef<"dish_category_variants", 'String'>
    readonly source: FieldRef<"dish_category_variants", 'String'>
    readonly created_at: FieldRef<"dish_category_variants", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * dish_category_variants findUnique
   */
  export type dish_category_variantsFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_category_variants
     */
    select?: dish_category_variantsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_category_variants
     */
    omit?: dish_category_variantsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_category_variantsInclude<ExtArgs> | null
    /**
     * Filter, which dish_category_variants to fetch.
     */
    where: dish_category_variantsWhereUniqueInput
  }

  /**
   * dish_category_variants findUniqueOrThrow
   */
  export type dish_category_variantsFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_category_variants
     */
    select?: dish_category_variantsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_category_variants
     */
    omit?: dish_category_variantsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_category_variantsInclude<ExtArgs> | null
    /**
     * Filter, which dish_category_variants to fetch.
     */
    where: dish_category_variantsWhereUniqueInput
  }

  /**
   * dish_category_variants findFirst
   */
  export type dish_category_variantsFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_category_variants
     */
    select?: dish_category_variantsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_category_variants
     */
    omit?: dish_category_variantsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_category_variantsInclude<ExtArgs> | null
    /**
     * Filter, which dish_category_variants to fetch.
     */
    where?: dish_category_variantsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of dish_category_variants to fetch.
     */
    orderBy?: dish_category_variantsOrderByWithRelationInput | dish_category_variantsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for dish_category_variants.
     */
    cursor?: dish_category_variantsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` dish_category_variants from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` dish_category_variants.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of dish_category_variants.
     */
    distinct?: Dish_category_variantsScalarFieldEnum | Dish_category_variantsScalarFieldEnum[]
  }

  /**
   * dish_category_variants findFirstOrThrow
   */
  export type dish_category_variantsFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_category_variants
     */
    select?: dish_category_variantsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_category_variants
     */
    omit?: dish_category_variantsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_category_variantsInclude<ExtArgs> | null
    /**
     * Filter, which dish_category_variants to fetch.
     */
    where?: dish_category_variantsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of dish_category_variants to fetch.
     */
    orderBy?: dish_category_variantsOrderByWithRelationInput | dish_category_variantsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for dish_category_variants.
     */
    cursor?: dish_category_variantsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` dish_category_variants from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` dish_category_variants.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of dish_category_variants.
     */
    distinct?: Dish_category_variantsScalarFieldEnum | Dish_category_variantsScalarFieldEnum[]
  }

  /**
   * dish_category_variants findMany
   */
  export type dish_category_variantsFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_category_variants
     */
    select?: dish_category_variantsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_category_variants
     */
    omit?: dish_category_variantsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_category_variantsInclude<ExtArgs> | null
    /**
     * Filter, which dish_category_variants to fetch.
     */
    where?: dish_category_variantsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of dish_category_variants to fetch.
     */
    orderBy?: dish_category_variantsOrderByWithRelationInput | dish_category_variantsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing dish_category_variants.
     */
    cursor?: dish_category_variantsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` dish_category_variants from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` dish_category_variants.
     */
    skip?: number
    distinct?: Dish_category_variantsScalarFieldEnum | Dish_category_variantsScalarFieldEnum[]
  }

  /**
   * dish_category_variants create
   */
  export type dish_category_variantsCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_category_variants
     */
    select?: dish_category_variantsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_category_variants
     */
    omit?: dish_category_variantsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_category_variantsInclude<ExtArgs> | null
    /**
     * The data needed to create a dish_category_variants.
     */
    data: XOR<dish_category_variantsCreateInput, dish_category_variantsUncheckedCreateInput>
  }

  /**
   * dish_category_variants createMany
   */
  export type dish_category_variantsCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many dish_category_variants.
     */
    data: dish_category_variantsCreateManyInput | dish_category_variantsCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * dish_category_variants createManyAndReturn
   */
  export type dish_category_variantsCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_category_variants
     */
    select?: dish_category_variantsSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the dish_category_variants
     */
    omit?: dish_category_variantsOmit<ExtArgs> | null
    /**
     * The data used to create many dish_category_variants.
     */
    data: dish_category_variantsCreateManyInput | dish_category_variantsCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_category_variantsIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * dish_category_variants update
   */
  export type dish_category_variantsUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_category_variants
     */
    select?: dish_category_variantsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_category_variants
     */
    omit?: dish_category_variantsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_category_variantsInclude<ExtArgs> | null
    /**
     * The data needed to update a dish_category_variants.
     */
    data: XOR<dish_category_variantsUpdateInput, dish_category_variantsUncheckedUpdateInput>
    /**
     * Choose, which dish_category_variants to update.
     */
    where: dish_category_variantsWhereUniqueInput
  }

  /**
   * dish_category_variants updateMany
   */
  export type dish_category_variantsUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update dish_category_variants.
     */
    data: XOR<dish_category_variantsUpdateManyMutationInput, dish_category_variantsUncheckedUpdateManyInput>
    /**
     * Filter which dish_category_variants to update
     */
    where?: dish_category_variantsWhereInput
    /**
     * Limit how many dish_category_variants to update.
     */
    limit?: number
  }

  /**
   * dish_category_variants updateManyAndReturn
   */
  export type dish_category_variantsUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_category_variants
     */
    select?: dish_category_variantsSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the dish_category_variants
     */
    omit?: dish_category_variantsOmit<ExtArgs> | null
    /**
     * The data used to update dish_category_variants.
     */
    data: XOR<dish_category_variantsUpdateManyMutationInput, dish_category_variantsUncheckedUpdateManyInput>
    /**
     * Filter which dish_category_variants to update
     */
    where?: dish_category_variantsWhereInput
    /**
     * Limit how many dish_category_variants to update.
     */
    limit?: number
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_category_variantsIncludeUpdateManyAndReturn<ExtArgs> | null
  }

  /**
   * dish_category_variants upsert
   */
  export type dish_category_variantsUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_category_variants
     */
    select?: dish_category_variantsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_category_variants
     */
    omit?: dish_category_variantsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_category_variantsInclude<ExtArgs> | null
    /**
     * The filter to search for the dish_category_variants to update in case it exists.
     */
    where: dish_category_variantsWhereUniqueInput
    /**
     * In case the dish_category_variants found by the `where` argument doesn't exist, create a new dish_category_variants with this data.
     */
    create: XOR<dish_category_variantsCreateInput, dish_category_variantsUncheckedCreateInput>
    /**
     * In case the dish_category_variants was found with the provided `where` argument, update it with this data.
     */
    update: XOR<dish_category_variantsUpdateInput, dish_category_variantsUncheckedUpdateInput>
  }

  /**
   * dish_category_variants delete
   */
  export type dish_category_variantsDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_category_variants
     */
    select?: dish_category_variantsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_category_variants
     */
    omit?: dish_category_variantsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_category_variantsInclude<ExtArgs> | null
    /**
     * Filter which dish_category_variants to delete.
     */
    where: dish_category_variantsWhereUniqueInput
  }

  /**
   * dish_category_variants deleteMany
   */
  export type dish_category_variantsDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which dish_category_variants to delete
     */
    where?: dish_category_variantsWhereInput
    /**
     * Limit how many dish_category_variants to delete.
     */
    limit?: number
  }

  /**
   * dish_category_variants without action
   */
  export type dish_category_variantsDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_category_variants
     */
    select?: dish_category_variantsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_category_variants
     */
    omit?: dish_category_variantsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_category_variantsInclude<ExtArgs> | null
  }


  /**
   * Model dish_likes
   */

  export type AggregateDish_likes = {
    _count: Dish_likesCountAggregateOutputType | null
    _min: Dish_likesMinAggregateOutputType | null
    _max: Dish_likesMaxAggregateOutputType | null
  }

  export type Dish_likesMinAggregateOutputType = {
    id: string | null
    dish_media_id: string | null
    user_id: string | null
    created_at: Date | null
  }

  export type Dish_likesMaxAggregateOutputType = {
    id: string | null
    dish_media_id: string | null
    user_id: string | null
    created_at: Date | null
  }

  export type Dish_likesCountAggregateOutputType = {
    id: number
    dish_media_id: number
    user_id: number
    created_at: number
    _all: number
  }


  export type Dish_likesMinAggregateInputType = {
    id?: true
    dish_media_id?: true
    user_id?: true
    created_at?: true
  }

  export type Dish_likesMaxAggregateInputType = {
    id?: true
    dish_media_id?: true
    user_id?: true
    created_at?: true
  }

  export type Dish_likesCountAggregateInputType = {
    id?: true
    dish_media_id?: true
    user_id?: true
    created_at?: true
    _all?: true
  }

  export type Dish_likesAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which dish_likes to aggregate.
     */
    where?: dish_likesWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of dish_likes to fetch.
     */
    orderBy?: dish_likesOrderByWithRelationInput | dish_likesOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: dish_likesWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` dish_likes from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` dish_likes.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned dish_likes
    **/
    _count?: true | Dish_likesCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: Dish_likesMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: Dish_likesMaxAggregateInputType
  }

  export type GetDish_likesAggregateType<T extends Dish_likesAggregateArgs> = {
        [P in keyof T & keyof AggregateDish_likes]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateDish_likes[P]>
      : GetScalarType<T[P], AggregateDish_likes[P]>
  }




  export type dish_likesGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: dish_likesWhereInput
    orderBy?: dish_likesOrderByWithAggregationInput | dish_likesOrderByWithAggregationInput[]
    by: Dish_likesScalarFieldEnum[] | Dish_likesScalarFieldEnum
    having?: dish_likesScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: Dish_likesCountAggregateInputType | true
    _min?: Dish_likesMinAggregateInputType
    _max?: Dish_likesMaxAggregateInputType
  }

  export type Dish_likesGroupByOutputType = {
    id: string
    dish_media_id: string
    user_id: string
    created_at: Date
    _count: Dish_likesCountAggregateOutputType | null
    _min: Dish_likesMinAggregateOutputType | null
    _max: Dish_likesMaxAggregateOutputType | null
  }

  type GetDish_likesGroupByPayload<T extends dish_likesGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<Dish_likesGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof Dish_likesGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], Dish_likesGroupByOutputType[P]>
            : GetScalarType<T[P], Dish_likesGroupByOutputType[P]>
        }
      >
    >


  export type dish_likesSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    dish_media_id?: boolean
    user_id?: boolean
    created_at?: boolean
    dish_media?: boolean | dish_mediaDefaultArgs<ExtArgs>
    users?: boolean | usersDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["dish_likes"]>

  export type dish_likesSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    dish_media_id?: boolean
    user_id?: boolean
    created_at?: boolean
    dish_media?: boolean | dish_mediaDefaultArgs<ExtArgs>
    users?: boolean | usersDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["dish_likes"]>

  export type dish_likesSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    dish_media_id?: boolean
    user_id?: boolean
    created_at?: boolean
    dish_media?: boolean | dish_mediaDefaultArgs<ExtArgs>
    users?: boolean | usersDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["dish_likes"]>

  export type dish_likesSelectScalar = {
    id?: boolean
    dish_media_id?: boolean
    user_id?: boolean
    created_at?: boolean
  }

  export type dish_likesOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "dish_media_id" | "user_id" | "created_at", ExtArgs["result"]["dish_likes"]>
  export type dish_likesInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    dish_media?: boolean | dish_mediaDefaultArgs<ExtArgs>
    users?: boolean | usersDefaultArgs<ExtArgs>
  }
  export type dish_likesIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    dish_media?: boolean | dish_mediaDefaultArgs<ExtArgs>
    users?: boolean | usersDefaultArgs<ExtArgs>
  }
  export type dish_likesIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    dish_media?: boolean | dish_mediaDefaultArgs<ExtArgs>
    users?: boolean | usersDefaultArgs<ExtArgs>
  }

  export type $dish_likesPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "dish_likes"
    objects: {
      dish_media: Prisma.$dish_mediaPayload<ExtArgs>
      users: Prisma.$usersPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      dish_media_id: string
      user_id: string
      created_at: Date
    }, ExtArgs["result"]["dish_likes"]>
    composites: {}
  }

  type dish_likesGetPayload<S extends boolean | null | undefined | dish_likesDefaultArgs> = $Result.GetResult<Prisma.$dish_likesPayload, S>

  type dish_likesCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<dish_likesFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: Dish_likesCountAggregateInputType | true
    }

  export interface dish_likesDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['dish_likes'], meta: { name: 'dish_likes' } }
    /**
     * Find zero or one Dish_likes that matches the filter.
     * @param {dish_likesFindUniqueArgs} args - Arguments to find a Dish_likes
     * @example
     * // Get one Dish_likes
     * const dish_likes = await prisma.dish_likes.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends dish_likesFindUniqueArgs>(args: SelectSubset<T, dish_likesFindUniqueArgs<ExtArgs>>): Prisma__dish_likesClient<$Result.GetResult<Prisma.$dish_likesPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one Dish_likes that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {dish_likesFindUniqueOrThrowArgs} args - Arguments to find a Dish_likes
     * @example
     * // Get one Dish_likes
     * const dish_likes = await prisma.dish_likes.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends dish_likesFindUniqueOrThrowArgs>(args: SelectSubset<T, dish_likesFindUniqueOrThrowArgs<ExtArgs>>): Prisma__dish_likesClient<$Result.GetResult<Prisma.$dish_likesPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Dish_likes that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {dish_likesFindFirstArgs} args - Arguments to find a Dish_likes
     * @example
     * // Get one Dish_likes
     * const dish_likes = await prisma.dish_likes.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends dish_likesFindFirstArgs>(args?: SelectSubset<T, dish_likesFindFirstArgs<ExtArgs>>): Prisma__dish_likesClient<$Result.GetResult<Prisma.$dish_likesPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Dish_likes that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {dish_likesFindFirstOrThrowArgs} args - Arguments to find a Dish_likes
     * @example
     * // Get one Dish_likes
     * const dish_likes = await prisma.dish_likes.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends dish_likesFindFirstOrThrowArgs>(args?: SelectSubset<T, dish_likesFindFirstOrThrowArgs<ExtArgs>>): Prisma__dish_likesClient<$Result.GetResult<Prisma.$dish_likesPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more Dish_likes that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {dish_likesFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Dish_likes
     * const dish_likes = await prisma.dish_likes.findMany()
     * 
     * // Get first 10 Dish_likes
     * const dish_likes = await prisma.dish_likes.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const dish_likesWithIdOnly = await prisma.dish_likes.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends dish_likesFindManyArgs>(args?: SelectSubset<T, dish_likesFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$dish_likesPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a Dish_likes.
     * @param {dish_likesCreateArgs} args - Arguments to create a Dish_likes.
     * @example
     * // Create one Dish_likes
     * const Dish_likes = await prisma.dish_likes.create({
     *   data: {
     *     // ... data to create a Dish_likes
     *   }
     * })
     * 
     */
    create<T extends dish_likesCreateArgs>(args: SelectSubset<T, dish_likesCreateArgs<ExtArgs>>): Prisma__dish_likesClient<$Result.GetResult<Prisma.$dish_likesPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many Dish_likes.
     * @param {dish_likesCreateManyArgs} args - Arguments to create many Dish_likes.
     * @example
     * // Create many Dish_likes
     * const dish_likes = await prisma.dish_likes.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends dish_likesCreateManyArgs>(args?: SelectSubset<T, dish_likesCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Dish_likes and returns the data saved in the database.
     * @param {dish_likesCreateManyAndReturnArgs} args - Arguments to create many Dish_likes.
     * @example
     * // Create many Dish_likes
     * const dish_likes = await prisma.dish_likes.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Dish_likes and only return the `id`
     * const dish_likesWithIdOnly = await prisma.dish_likes.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends dish_likesCreateManyAndReturnArgs>(args?: SelectSubset<T, dish_likesCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$dish_likesPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a Dish_likes.
     * @param {dish_likesDeleteArgs} args - Arguments to delete one Dish_likes.
     * @example
     * // Delete one Dish_likes
     * const Dish_likes = await prisma.dish_likes.delete({
     *   where: {
     *     // ... filter to delete one Dish_likes
     *   }
     * })
     * 
     */
    delete<T extends dish_likesDeleteArgs>(args: SelectSubset<T, dish_likesDeleteArgs<ExtArgs>>): Prisma__dish_likesClient<$Result.GetResult<Prisma.$dish_likesPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one Dish_likes.
     * @param {dish_likesUpdateArgs} args - Arguments to update one Dish_likes.
     * @example
     * // Update one Dish_likes
     * const dish_likes = await prisma.dish_likes.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends dish_likesUpdateArgs>(args: SelectSubset<T, dish_likesUpdateArgs<ExtArgs>>): Prisma__dish_likesClient<$Result.GetResult<Prisma.$dish_likesPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more Dish_likes.
     * @param {dish_likesDeleteManyArgs} args - Arguments to filter Dish_likes to delete.
     * @example
     * // Delete a few Dish_likes
     * const { count } = await prisma.dish_likes.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends dish_likesDeleteManyArgs>(args?: SelectSubset<T, dish_likesDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Dish_likes.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {dish_likesUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Dish_likes
     * const dish_likes = await prisma.dish_likes.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends dish_likesUpdateManyArgs>(args: SelectSubset<T, dish_likesUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Dish_likes and returns the data updated in the database.
     * @param {dish_likesUpdateManyAndReturnArgs} args - Arguments to update many Dish_likes.
     * @example
     * // Update many Dish_likes
     * const dish_likes = await prisma.dish_likes.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more Dish_likes and only return the `id`
     * const dish_likesWithIdOnly = await prisma.dish_likes.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends dish_likesUpdateManyAndReturnArgs>(args: SelectSubset<T, dish_likesUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$dish_likesPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one Dish_likes.
     * @param {dish_likesUpsertArgs} args - Arguments to update or create a Dish_likes.
     * @example
     * // Update or create a Dish_likes
     * const dish_likes = await prisma.dish_likes.upsert({
     *   create: {
     *     // ... data to create a Dish_likes
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Dish_likes we want to update
     *   }
     * })
     */
    upsert<T extends dish_likesUpsertArgs>(args: SelectSubset<T, dish_likesUpsertArgs<ExtArgs>>): Prisma__dish_likesClient<$Result.GetResult<Prisma.$dish_likesPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of Dish_likes.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {dish_likesCountArgs} args - Arguments to filter Dish_likes to count.
     * @example
     * // Count the number of Dish_likes
     * const count = await prisma.dish_likes.count({
     *   where: {
     *     // ... the filter for the Dish_likes we want to count
     *   }
     * })
    **/
    count<T extends dish_likesCountArgs>(
      args?: Subset<T, dish_likesCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], Dish_likesCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Dish_likes.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Dish_likesAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends Dish_likesAggregateArgs>(args: Subset<T, Dish_likesAggregateArgs>): Prisma.PrismaPromise<GetDish_likesAggregateType<T>>

    /**
     * Group by Dish_likes.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {dish_likesGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends dish_likesGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: dish_likesGroupByArgs['orderBy'] }
        : { orderBy?: dish_likesGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, dish_likesGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetDish_likesGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the dish_likes model
   */
  readonly fields: dish_likesFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for dish_likes.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__dish_likesClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    dish_media<T extends dish_mediaDefaultArgs<ExtArgs> = {}>(args?: Subset<T, dish_mediaDefaultArgs<ExtArgs>>): Prisma__dish_mediaClient<$Result.GetResult<Prisma.$dish_mediaPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    users<T extends usersDefaultArgs<ExtArgs> = {}>(args?: Subset<T, usersDefaultArgs<ExtArgs>>): Prisma__usersClient<$Result.GetResult<Prisma.$usersPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the dish_likes model
   */
  interface dish_likesFieldRefs {
    readonly id: FieldRef<"dish_likes", 'String'>
    readonly dish_media_id: FieldRef<"dish_likes", 'String'>
    readonly user_id: FieldRef<"dish_likes", 'String'>
    readonly created_at: FieldRef<"dish_likes", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * dish_likes findUnique
   */
  export type dish_likesFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_likes
     */
    select?: dish_likesSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_likes
     */
    omit?: dish_likesOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_likesInclude<ExtArgs> | null
    /**
     * Filter, which dish_likes to fetch.
     */
    where: dish_likesWhereUniqueInput
  }

  /**
   * dish_likes findUniqueOrThrow
   */
  export type dish_likesFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_likes
     */
    select?: dish_likesSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_likes
     */
    omit?: dish_likesOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_likesInclude<ExtArgs> | null
    /**
     * Filter, which dish_likes to fetch.
     */
    where: dish_likesWhereUniqueInput
  }

  /**
   * dish_likes findFirst
   */
  export type dish_likesFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_likes
     */
    select?: dish_likesSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_likes
     */
    omit?: dish_likesOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_likesInclude<ExtArgs> | null
    /**
     * Filter, which dish_likes to fetch.
     */
    where?: dish_likesWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of dish_likes to fetch.
     */
    orderBy?: dish_likesOrderByWithRelationInput | dish_likesOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for dish_likes.
     */
    cursor?: dish_likesWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` dish_likes from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` dish_likes.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of dish_likes.
     */
    distinct?: Dish_likesScalarFieldEnum | Dish_likesScalarFieldEnum[]
  }

  /**
   * dish_likes findFirstOrThrow
   */
  export type dish_likesFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_likes
     */
    select?: dish_likesSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_likes
     */
    omit?: dish_likesOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_likesInclude<ExtArgs> | null
    /**
     * Filter, which dish_likes to fetch.
     */
    where?: dish_likesWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of dish_likes to fetch.
     */
    orderBy?: dish_likesOrderByWithRelationInput | dish_likesOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for dish_likes.
     */
    cursor?: dish_likesWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` dish_likes from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` dish_likes.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of dish_likes.
     */
    distinct?: Dish_likesScalarFieldEnum | Dish_likesScalarFieldEnum[]
  }

  /**
   * dish_likes findMany
   */
  export type dish_likesFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_likes
     */
    select?: dish_likesSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_likes
     */
    omit?: dish_likesOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_likesInclude<ExtArgs> | null
    /**
     * Filter, which dish_likes to fetch.
     */
    where?: dish_likesWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of dish_likes to fetch.
     */
    orderBy?: dish_likesOrderByWithRelationInput | dish_likesOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing dish_likes.
     */
    cursor?: dish_likesWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` dish_likes from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` dish_likes.
     */
    skip?: number
    distinct?: Dish_likesScalarFieldEnum | Dish_likesScalarFieldEnum[]
  }

  /**
   * dish_likes create
   */
  export type dish_likesCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_likes
     */
    select?: dish_likesSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_likes
     */
    omit?: dish_likesOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_likesInclude<ExtArgs> | null
    /**
     * The data needed to create a dish_likes.
     */
    data: XOR<dish_likesCreateInput, dish_likesUncheckedCreateInput>
  }

  /**
   * dish_likes createMany
   */
  export type dish_likesCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many dish_likes.
     */
    data: dish_likesCreateManyInput | dish_likesCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * dish_likes createManyAndReturn
   */
  export type dish_likesCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_likes
     */
    select?: dish_likesSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the dish_likes
     */
    omit?: dish_likesOmit<ExtArgs> | null
    /**
     * The data used to create many dish_likes.
     */
    data: dish_likesCreateManyInput | dish_likesCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_likesIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * dish_likes update
   */
  export type dish_likesUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_likes
     */
    select?: dish_likesSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_likes
     */
    omit?: dish_likesOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_likesInclude<ExtArgs> | null
    /**
     * The data needed to update a dish_likes.
     */
    data: XOR<dish_likesUpdateInput, dish_likesUncheckedUpdateInput>
    /**
     * Choose, which dish_likes to update.
     */
    where: dish_likesWhereUniqueInput
  }

  /**
   * dish_likes updateMany
   */
  export type dish_likesUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update dish_likes.
     */
    data: XOR<dish_likesUpdateManyMutationInput, dish_likesUncheckedUpdateManyInput>
    /**
     * Filter which dish_likes to update
     */
    where?: dish_likesWhereInput
    /**
     * Limit how many dish_likes to update.
     */
    limit?: number
  }

  /**
   * dish_likes updateManyAndReturn
   */
  export type dish_likesUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_likes
     */
    select?: dish_likesSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the dish_likes
     */
    omit?: dish_likesOmit<ExtArgs> | null
    /**
     * The data used to update dish_likes.
     */
    data: XOR<dish_likesUpdateManyMutationInput, dish_likesUncheckedUpdateManyInput>
    /**
     * Filter which dish_likes to update
     */
    where?: dish_likesWhereInput
    /**
     * Limit how many dish_likes to update.
     */
    limit?: number
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_likesIncludeUpdateManyAndReturn<ExtArgs> | null
  }

  /**
   * dish_likes upsert
   */
  export type dish_likesUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_likes
     */
    select?: dish_likesSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_likes
     */
    omit?: dish_likesOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_likesInclude<ExtArgs> | null
    /**
     * The filter to search for the dish_likes to update in case it exists.
     */
    where: dish_likesWhereUniqueInput
    /**
     * In case the dish_likes found by the `where` argument doesn't exist, create a new dish_likes with this data.
     */
    create: XOR<dish_likesCreateInput, dish_likesUncheckedCreateInput>
    /**
     * In case the dish_likes was found with the provided `where` argument, update it with this data.
     */
    update: XOR<dish_likesUpdateInput, dish_likesUncheckedUpdateInput>
  }

  /**
   * dish_likes delete
   */
  export type dish_likesDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_likes
     */
    select?: dish_likesSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_likes
     */
    omit?: dish_likesOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_likesInclude<ExtArgs> | null
    /**
     * Filter which dish_likes to delete.
     */
    where: dish_likesWhereUniqueInput
  }

  /**
   * dish_likes deleteMany
   */
  export type dish_likesDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which dish_likes to delete
     */
    where?: dish_likesWhereInput
    /**
     * Limit how many dish_likes to delete.
     */
    limit?: number
  }

  /**
   * dish_likes without action
   */
  export type dish_likesDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_likes
     */
    select?: dish_likesSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_likes
     */
    omit?: dish_likesOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_likesInclude<ExtArgs> | null
  }


  /**
   * Model dish_media
   */

  export type AggregateDish_media = {
    _count: Dish_mediaCountAggregateOutputType | null
    _avg: Dish_mediaAvgAggregateOutputType | null
    _sum: Dish_mediaSumAggregateOutputType | null
    _min: Dish_mediaMinAggregateOutputType | null
    _max: Dish_mediaMaxAggregateOutputType | null
  }

  export type Dish_mediaAvgAggregateOutputType = {
    lock_no: number | null
  }

  export type Dish_mediaSumAggregateOutputType = {
    lock_no: number | null
  }

  export type Dish_mediaMinAggregateOutputType = {
    id: string | null
    dish_id: string | null
    user_id: string | null
    media_path: string | null
    media_type: string | null
    thumbnail_path: string | null
    created_at: Date | null
    updated_at: Date | null
    lock_no: number | null
  }

  export type Dish_mediaMaxAggregateOutputType = {
    id: string | null
    dish_id: string | null
    user_id: string | null
    media_path: string | null
    media_type: string | null
    thumbnail_path: string | null
    created_at: Date | null
    updated_at: Date | null
    lock_no: number | null
  }

  export type Dish_mediaCountAggregateOutputType = {
    id: number
    dish_id: number
    user_id: number
    media_path: number
    media_type: number
    thumbnail_path: number
    created_at: number
    updated_at: number
    lock_no: number
    _all: number
  }


  export type Dish_mediaAvgAggregateInputType = {
    lock_no?: true
  }

  export type Dish_mediaSumAggregateInputType = {
    lock_no?: true
  }

  export type Dish_mediaMinAggregateInputType = {
    id?: true
    dish_id?: true
    user_id?: true
    media_path?: true
    media_type?: true
    thumbnail_path?: true
    created_at?: true
    updated_at?: true
    lock_no?: true
  }

  export type Dish_mediaMaxAggregateInputType = {
    id?: true
    dish_id?: true
    user_id?: true
    media_path?: true
    media_type?: true
    thumbnail_path?: true
    created_at?: true
    updated_at?: true
    lock_no?: true
  }

  export type Dish_mediaCountAggregateInputType = {
    id?: true
    dish_id?: true
    user_id?: true
    media_path?: true
    media_type?: true
    thumbnail_path?: true
    created_at?: true
    updated_at?: true
    lock_no?: true
    _all?: true
  }

  export type Dish_mediaAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which dish_media to aggregate.
     */
    where?: dish_mediaWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of dish_medias to fetch.
     */
    orderBy?: dish_mediaOrderByWithRelationInput | dish_mediaOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: dish_mediaWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` dish_medias from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` dish_medias.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned dish_medias
    **/
    _count?: true | Dish_mediaCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: Dish_mediaAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: Dish_mediaSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: Dish_mediaMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: Dish_mediaMaxAggregateInputType
  }

  export type GetDish_mediaAggregateType<T extends Dish_mediaAggregateArgs> = {
        [P in keyof T & keyof AggregateDish_media]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateDish_media[P]>
      : GetScalarType<T[P], AggregateDish_media[P]>
  }




  export type dish_mediaGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: dish_mediaWhereInput
    orderBy?: dish_mediaOrderByWithAggregationInput | dish_mediaOrderByWithAggregationInput[]
    by: Dish_mediaScalarFieldEnum[] | Dish_mediaScalarFieldEnum
    having?: dish_mediaScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: Dish_mediaCountAggregateInputType | true
    _avg?: Dish_mediaAvgAggregateInputType
    _sum?: Dish_mediaSumAggregateInputType
    _min?: Dish_mediaMinAggregateInputType
    _max?: Dish_mediaMaxAggregateInputType
  }

  export type Dish_mediaGroupByOutputType = {
    id: string
    dish_id: string
    user_id: string | null
    media_path: string
    media_type: string
    thumbnail_path: string | null
    created_at: Date
    updated_at: Date
    lock_no: number
    _count: Dish_mediaCountAggregateOutputType | null
    _avg: Dish_mediaAvgAggregateOutputType | null
    _sum: Dish_mediaSumAggregateOutputType | null
    _min: Dish_mediaMinAggregateOutputType | null
    _max: Dish_mediaMaxAggregateOutputType | null
  }

  type GetDish_mediaGroupByPayload<T extends dish_mediaGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<Dish_mediaGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof Dish_mediaGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], Dish_mediaGroupByOutputType[P]>
            : GetScalarType<T[P], Dish_mediaGroupByOutputType[P]>
        }
      >
    >


  export type dish_mediaSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    dish_id?: boolean
    user_id?: boolean
    media_path?: boolean
    media_type?: boolean
    thumbnail_path?: boolean
    created_at?: boolean
    updated_at?: boolean
    lock_no?: boolean
    dish_likes?: boolean | dish_media$dish_likesArgs<ExtArgs>
    dishes?: boolean | dishesDefaultArgs<ExtArgs>
    users?: boolean | dish_media$usersArgs<ExtArgs>
    payouts?: boolean | dish_media$payoutsArgs<ExtArgs>
    _count?: boolean | Dish_mediaCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["dish_media"]>

  export type dish_mediaSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    dish_id?: boolean
    user_id?: boolean
    media_path?: boolean
    media_type?: boolean
    thumbnail_path?: boolean
    created_at?: boolean
    updated_at?: boolean
    lock_no?: boolean
    dishes?: boolean | dishesDefaultArgs<ExtArgs>
    users?: boolean | dish_media$usersArgs<ExtArgs>
  }, ExtArgs["result"]["dish_media"]>

  export type dish_mediaSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    dish_id?: boolean
    user_id?: boolean
    media_path?: boolean
    media_type?: boolean
    thumbnail_path?: boolean
    created_at?: boolean
    updated_at?: boolean
    lock_no?: boolean
    dishes?: boolean | dishesDefaultArgs<ExtArgs>
    users?: boolean | dish_media$usersArgs<ExtArgs>
  }, ExtArgs["result"]["dish_media"]>

  export type dish_mediaSelectScalar = {
    id?: boolean
    dish_id?: boolean
    user_id?: boolean
    media_path?: boolean
    media_type?: boolean
    thumbnail_path?: boolean
    created_at?: boolean
    updated_at?: boolean
    lock_no?: boolean
  }

  export type dish_mediaOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "dish_id" | "user_id" | "media_path" | "media_type" | "thumbnail_path" | "created_at" | "updated_at" | "lock_no", ExtArgs["result"]["dish_media"]>
  export type dish_mediaInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    dish_likes?: boolean | dish_media$dish_likesArgs<ExtArgs>
    dishes?: boolean | dishesDefaultArgs<ExtArgs>
    users?: boolean | dish_media$usersArgs<ExtArgs>
    payouts?: boolean | dish_media$payoutsArgs<ExtArgs>
    _count?: boolean | Dish_mediaCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type dish_mediaIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    dishes?: boolean | dishesDefaultArgs<ExtArgs>
    users?: boolean | dish_media$usersArgs<ExtArgs>
  }
  export type dish_mediaIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    dishes?: boolean | dishesDefaultArgs<ExtArgs>
    users?: boolean | dish_media$usersArgs<ExtArgs>
  }

  export type $dish_mediaPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "dish_media"
    objects: {
      dish_likes: Prisma.$dish_likesPayload<ExtArgs>[]
      dishes: Prisma.$dishesPayload<ExtArgs>
      users: Prisma.$usersPayload<ExtArgs> | null
      payouts: Prisma.$payoutsPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      dish_id: string
      user_id: string | null
      media_path: string
      media_type: string
      thumbnail_path: string | null
      created_at: Date
      updated_at: Date
      lock_no: number
    }, ExtArgs["result"]["dish_media"]>
    composites: {}
  }

  type dish_mediaGetPayload<S extends boolean | null | undefined | dish_mediaDefaultArgs> = $Result.GetResult<Prisma.$dish_mediaPayload, S>

  type dish_mediaCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<dish_mediaFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: Dish_mediaCountAggregateInputType | true
    }

  export interface dish_mediaDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['dish_media'], meta: { name: 'dish_media' } }
    /**
     * Find zero or one Dish_media that matches the filter.
     * @param {dish_mediaFindUniqueArgs} args - Arguments to find a Dish_media
     * @example
     * // Get one Dish_media
     * const dish_media = await prisma.dish_media.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends dish_mediaFindUniqueArgs>(args: SelectSubset<T, dish_mediaFindUniqueArgs<ExtArgs>>): Prisma__dish_mediaClient<$Result.GetResult<Prisma.$dish_mediaPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one Dish_media that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {dish_mediaFindUniqueOrThrowArgs} args - Arguments to find a Dish_media
     * @example
     * // Get one Dish_media
     * const dish_media = await prisma.dish_media.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends dish_mediaFindUniqueOrThrowArgs>(args: SelectSubset<T, dish_mediaFindUniqueOrThrowArgs<ExtArgs>>): Prisma__dish_mediaClient<$Result.GetResult<Prisma.$dish_mediaPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Dish_media that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {dish_mediaFindFirstArgs} args - Arguments to find a Dish_media
     * @example
     * // Get one Dish_media
     * const dish_media = await prisma.dish_media.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends dish_mediaFindFirstArgs>(args?: SelectSubset<T, dish_mediaFindFirstArgs<ExtArgs>>): Prisma__dish_mediaClient<$Result.GetResult<Prisma.$dish_mediaPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Dish_media that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {dish_mediaFindFirstOrThrowArgs} args - Arguments to find a Dish_media
     * @example
     * // Get one Dish_media
     * const dish_media = await prisma.dish_media.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends dish_mediaFindFirstOrThrowArgs>(args?: SelectSubset<T, dish_mediaFindFirstOrThrowArgs<ExtArgs>>): Prisma__dish_mediaClient<$Result.GetResult<Prisma.$dish_mediaPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more Dish_medias that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {dish_mediaFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Dish_medias
     * const dish_medias = await prisma.dish_media.findMany()
     * 
     * // Get first 10 Dish_medias
     * const dish_medias = await prisma.dish_media.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const dish_mediaWithIdOnly = await prisma.dish_media.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends dish_mediaFindManyArgs>(args?: SelectSubset<T, dish_mediaFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$dish_mediaPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a Dish_media.
     * @param {dish_mediaCreateArgs} args - Arguments to create a Dish_media.
     * @example
     * // Create one Dish_media
     * const Dish_media = await prisma.dish_media.create({
     *   data: {
     *     // ... data to create a Dish_media
     *   }
     * })
     * 
     */
    create<T extends dish_mediaCreateArgs>(args: SelectSubset<T, dish_mediaCreateArgs<ExtArgs>>): Prisma__dish_mediaClient<$Result.GetResult<Prisma.$dish_mediaPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many Dish_medias.
     * @param {dish_mediaCreateManyArgs} args - Arguments to create many Dish_medias.
     * @example
     * // Create many Dish_medias
     * const dish_media = await prisma.dish_media.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends dish_mediaCreateManyArgs>(args?: SelectSubset<T, dish_mediaCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Dish_medias and returns the data saved in the database.
     * @param {dish_mediaCreateManyAndReturnArgs} args - Arguments to create many Dish_medias.
     * @example
     * // Create many Dish_medias
     * const dish_media = await prisma.dish_media.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Dish_medias and only return the `id`
     * const dish_mediaWithIdOnly = await prisma.dish_media.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends dish_mediaCreateManyAndReturnArgs>(args?: SelectSubset<T, dish_mediaCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$dish_mediaPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a Dish_media.
     * @param {dish_mediaDeleteArgs} args - Arguments to delete one Dish_media.
     * @example
     * // Delete one Dish_media
     * const Dish_media = await prisma.dish_media.delete({
     *   where: {
     *     // ... filter to delete one Dish_media
     *   }
     * })
     * 
     */
    delete<T extends dish_mediaDeleteArgs>(args: SelectSubset<T, dish_mediaDeleteArgs<ExtArgs>>): Prisma__dish_mediaClient<$Result.GetResult<Prisma.$dish_mediaPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one Dish_media.
     * @param {dish_mediaUpdateArgs} args - Arguments to update one Dish_media.
     * @example
     * // Update one Dish_media
     * const dish_media = await prisma.dish_media.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends dish_mediaUpdateArgs>(args: SelectSubset<T, dish_mediaUpdateArgs<ExtArgs>>): Prisma__dish_mediaClient<$Result.GetResult<Prisma.$dish_mediaPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more Dish_medias.
     * @param {dish_mediaDeleteManyArgs} args - Arguments to filter Dish_medias to delete.
     * @example
     * // Delete a few Dish_medias
     * const { count } = await prisma.dish_media.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends dish_mediaDeleteManyArgs>(args?: SelectSubset<T, dish_mediaDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Dish_medias.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {dish_mediaUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Dish_medias
     * const dish_media = await prisma.dish_media.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends dish_mediaUpdateManyArgs>(args: SelectSubset<T, dish_mediaUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Dish_medias and returns the data updated in the database.
     * @param {dish_mediaUpdateManyAndReturnArgs} args - Arguments to update many Dish_medias.
     * @example
     * // Update many Dish_medias
     * const dish_media = await prisma.dish_media.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more Dish_medias and only return the `id`
     * const dish_mediaWithIdOnly = await prisma.dish_media.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends dish_mediaUpdateManyAndReturnArgs>(args: SelectSubset<T, dish_mediaUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$dish_mediaPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one Dish_media.
     * @param {dish_mediaUpsertArgs} args - Arguments to update or create a Dish_media.
     * @example
     * // Update or create a Dish_media
     * const dish_media = await prisma.dish_media.upsert({
     *   create: {
     *     // ... data to create a Dish_media
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Dish_media we want to update
     *   }
     * })
     */
    upsert<T extends dish_mediaUpsertArgs>(args: SelectSubset<T, dish_mediaUpsertArgs<ExtArgs>>): Prisma__dish_mediaClient<$Result.GetResult<Prisma.$dish_mediaPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of Dish_medias.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {dish_mediaCountArgs} args - Arguments to filter Dish_medias to count.
     * @example
     * // Count the number of Dish_medias
     * const count = await prisma.dish_media.count({
     *   where: {
     *     // ... the filter for the Dish_medias we want to count
     *   }
     * })
    **/
    count<T extends dish_mediaCountArgs>(
      args?: Subset<T, dish_mediaCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], Dish_mediaCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Dish_media.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Dish_mediaAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends Dish_mediaAggregateArgs>(args: Subset<T, Dish_mediaAggregateArgs>): Prisma.PrismaPromise<GetDish_mediaAggregateType<T>>

    /**
     * Group by Dish_media.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {dish_mediaGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends dish_mediaGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: dish_mediaGroupByArgs['orderBy'] }
        : { orderBy?: dish_mediaGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, dish_mediaGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetDish_mediaGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the dish_media model
   */
  readonly fields: dish_mediaFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for dish_media.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__dish_mediaClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    dish_likes<T extends dish_media$dish_likesArgs<ExtArgs> = {}>(args?: Subset<T, dish_media$dish_likesArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$dish_likesPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    dishes<T extends dishesDefaultArgs<ExtArgs> = {}>(args?: Subset<T, dishesDefaultArgs<ExtArgs>>): Prisma__dishesClient<$Result.GetResult<Prisma.$dishesPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    users<T extends dish_media$usersArgs<ExtArgs> = {}>(args?: Subset<T, dish_media$usersArgs<ExtArgs>>): Prisma__usersClient<$Result.GetResult<Prisma.$usersPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>
    payouts<T extends dish_media$payoutsArgs<ExtArgs> = {}>(args?: Subset<T, dish_media$payoutsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$payoutsPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the dish_media model
   */
  interface dish_mediaFieldRefs {
    readonly id: FieldRef<"dish_media", 'String'>
    readonly dish_id: FieldRef<"dish_media", 'String'>
    readonly user_id: FieldRef<"dish_media", 'String'>
    readonly media_path: FieldRef<"dish_media", 'String'>
    readonly media_type: FieldRef<"dish_media", 'String'>
    readonly thumbnail_path: FieldRef<"dish_media", 'String'>
    readonly created_at: FieldRef<"dish_media", 'DateTime'>
    readonly updated_at: FieldRef<"dish_media", 'DateTime'>
    readonly lock_no: FieldRef<"dish_media", 'Int'>
  }
    

  // Custom InputTypes
  /**
   * dish_media findUnique
   */
  export type dish_mediaFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_media
     */
    select?: dish_mediaSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_media
     */
    omit?: dish_mediaOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_mediaInclude<ExtArgs> | null
    /**
     * Filter, which dish_media to fetch.
     */
    where: dish_mediaWhereUniqueInput
  }

  /**
   * dish_media findUniqueOrThrow
   */
  export type dish_mediaFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_media
     */
    select?: dish_mediaSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_media
     */
    omit?: dish_mediaOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_mediaInclude<ExtArgs> | null
    /**
     * Filter, which dish_media to fetch.
     */
    where: dish_mediaWhereUniqueInput
  }

  /**
   * dish_media findFirst
   */
  export type dish_mediaFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_media
     */
    select?: dish_mediaSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_media
     */
    omit?: dish_mediaOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_mediaInclude<ExtArgs> | null
    /**
     * Filter, which dish_media to fetch.
     */
    where?: dish_mediaWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of dish_medias to fetch.
     */
    orderBy?: dish_mediaOrderByWithRelationInput | dish_mediaOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for dish_medias.
     */
    cursor?: dish_mediaWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` dish_medias from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` dish_medias.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of dish_medias.
     */
    distinct?: Dish_mediaScalarFieldEnum | Dish_mediaScalarFieldEnum[]
  }

  /**
   * dish_media findFirstOrThrow
   */
  export type dish_mediaFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_media
     */
    select?: dish_mediaSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_media
     */
    omit?: dish_mediaOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_mediaInclude<ExtArgs> | null
    /**
     * Filter, which dish_media to fetch.
     */
    where?: dish_mediaWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of dish_medias to fetch.
     */
    orderBy?: dish_mediaOrderByWithRelationInput | dish_mediaOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for dish_medias.
     */
    cursor?: dish_mediaWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` dish_medias from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` dish_medias.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of dish_medias.
     */
    distinct?: Dish_mediaScalarFieldEnum | Dish_mediaScalarFieldEnum[]
  }

  /**
   * dish_media findMany
   */
  export type dish_mediaFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_media
     */
    select?: dish_mediaSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_media
     */
    omit?: dish_mediaOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_mediaInclude<ExtArgs> | null
    /**
     * Filter, which dish_medias to fetch.
     */
    where?: dish_mediaWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of dish_medias to fetch.
     */
    orderBy?: dish_mediaOrderByWithRelationInput | dish_mediaOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing dish_medias.
     */
    cursor?: dish_mediaWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` dish_medias from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` dish_medias.
     */
    skip?: number
    distinct?: Dish_mediaScalarFieldEnum | Dish_mediaScalarFieldEnum[]
  }

  /**
   * dish_media create
   */
  export type dish_mediaCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_media
     */
    select?: dish_mediaSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_media
     */
    omit?: dish_mediaOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_mediaInclude<ExtArgs> | null
    /**
     * The data needed to create a dish_media.
     */
    data: XOR<dish_mediaCreateInput, dish_mediaUncheckedCreateInput>
  }

  /**
   * dish_media createMany
   */
  export type dish_mediaCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many dish_medias.
     */
    data: dish_mediaCreateManyInput | dish_mediaCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * dish_media createManyAndReturn
   */
  export type dish_mediaCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_media
     */
    select?: dish_mediaSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the dish_media
     */
    omit?: dish_mediaOmit<ExtArgs> | null
    /**
     * The data used to create many dish_medias.
     */
    data: dish_mediaCreateManyInput | dish_mediaCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_mediaIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * dish_media update
   */
  export type dish_mediaUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_media
     */
    select?: dish_mediaSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_media
     */
    omit?: dish_mediaOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_mediaInclude<ExtArgs> | null
    /**
     * The data needed to update a dish_media.
     */
    data: XOR<dish_mediaUpdateInput, dish_mediaUncheckedUpdateInput>
    /**
     * Choose, which dish_media to update.
     */
    where: dish_mediaWhereUniqueInput
  }

  /**
   * dish_media updateMany
   */
  export type dish_mediaUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update dish_medias.
     */
    data: XOR<dish_mediaUpdateManyMutationInput, dish_mediaUncheckedUpdateManyInput>
    /**
     * Filter which dish_medias to update
     */
    where?: dish_mediaWhereInput
    /**
     * Limit how many dish_medias to update.
     */
    limit?: number
  }

  /**
   * dish_media updateManyAndReturn
   */
  export type dish_mediaUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_media
     */
    select?: dish_mediaSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the dish_media
     */
    omit?: dish_mediaOmit<ExtArgs> | null
    /**
     * The data used to update dish_medias.
     */
    data: XOR<dish_mediaUpdateManyMutationInput, dish_mediaUncheckedUpdateManyInput>
    /**
     * Filter which dish_medias to update
     */
    where?: dish_mediaWhereInput
    /**
     * Limit how many dish_medias to update.
     */
    limit?: number
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_mediaIncludeUpdateManyAndReturn<ExtArgs> | null
  }

  /**
   * dish_media upsert
   */
  export type dish_mediaUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_media
     */
    select?: dish_mediaSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_media
     */
    omit?: dish_mediaOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_mediaInclude<ExtArgs> | null
    /**
     * The filter to search for the dish_media to update in case it exists.
     */
    where: dish_mediaWhereUniqueInput
    /**
     * In case the dish_media found by the `where` argument doesn't exist, create a new dish_media with this data.
     */
    create: XOR<dish_mediaCreateInput, dish_mediaUncheckedCreateInput>
    /**
     * In case the dish_media was found with the provided `where` argument, update it with this data.
     */
    update: XOR<dish_mediaUpdateInput, dish_mediaUncheckedUpdateInput>
  }

  /**
   * dish_media delete
   */
  export type dish_mediaDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_media
     */
    select?: dish_mediaSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_media
     */
    omit?: dish_mediaOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_mediaInclude<ExtArgs> | null
    /**
     * Filter which dish_media to delete.
     */
    where: dish_mediaWhereUniqueInput
  }

  /**
   * dish_media deleteMany
   */
  export type dish_mediaDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which dish_medias to delete
     */
    where?: dish_mediaWhereInput
    /**
     * Limit how many dish_medias to delete.
     */
    limit?: number
  }

  /**
   * dish_media.dish_likes
   */
  export type dish_media$dish_likesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_likes
     */
    select?: dish_likesSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_likes
     */
    omit?: dish_likesOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_likesInclude<ExtArgs> | null
    where?: dish_likesWhereInput
    orderBy?: dish_likesOrderByWithRelationInput | dish_likesOrderByWithRelationInput[]
    cursor?: dish_likesWhereUniqueInput
    take?: number
    skip?: number
    distinct?: Dish_likesScalarFieldEnum | Dish_likesScalarFieldEnum[]
  }

  /**
   * dish_media.users
   */
  export type dish_media$usersArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the users
     */
    select?: usersSelect<ExtArgs> | null
    /**
     * Omit specific fields from the users
     */
    omit?: usersOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: usersInclude<ExtArgs> | null
    where?: usersWhereInput
  }

  /**
   * dish_media.payouts
   */
  export type dish_media$payoutsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the payouts
     */
    select?: payoutsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the payouts
     */
    omit?: payoutsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: payoutsInclude<ExtArgs> | null
    where?: payoutsWhereInput
    orderBy?: payoutsOrderByWithRelationInput | payoutsOrderByWithRelationInput[]
    cursor?: payoutsWhereUniqueInput
    take?: number
    skip?: number
    distinct?: PayoutsScalarFieldEnum | PayoutsScalarFieldEnum[]
  }

  /**
   * dish_media without action
   */
  export type dish_mediaDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_media
     */
    select?: dish_mediaSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_media
     */
    omit?: dish_mediaOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_mediaInclude<ExtArgs> | null
  }


  /**
   * Model dish_reviews
   */

  export type AggregateDish_reviews = {
    _count: Dish_reviewsCountAggregateOutputType | null
    _avg: Dish_reviewsAvgAggregateOutputType | null
    _sum: Dish_reviewsSumAggregateOutputType | null
    _min: Dish_reviewsMinAggregateOutputType | null
    _max: Dish_reviewsMaxAggregateOutputType | null
  }

  export type Dish_reviewsAvgAggregateOutputType = {
    rating: number | null
    price_cents: number | null
  }

  export type Dish_reviewsSumAggregateOutputType = {
    rating: number | null
    price_cents: number | null
  }

  export type Dish_reviewsMinAggregateOutputType = {
    id: string | null
    dish_id: string | null
    comment: string | null
    user_id: string | null
    rating: number | null
    price_cents: number | null
    currency_code: string | null
    created_dish_media_id: string | null
    imported_user_name: string | null
    imported_user_avatar: string | null
    created_at: Date | null
  }

  export type Dish_reviewsMaxAggregateOutputType = {
    id: string | null
    dish_id: string | null
    comment: string | null
    user_id: string | null
    rating: number | null
    price_cents: number | null
    currency_code: string | null
    created_dish_media_id: string | null
    imported_user_name: string | null
    imported_user_avatar: string | null
    created_at: Date | null
  }

  export type Dish_reviewsCountAggregateOutputType = {
    id: number
    dish_id: number
    comment: number
    user_id: number
    rating: number
    price_cents: number
    currency_code: number
    created_dish_media_id: number
    imported_user_name: number
    imported_user_avatar: number
    created_at: number
    _all: number
  }


  export type Dish_reviewsAvgAggregateInputType = {
    rating?: true
    price_cents?: true
  }

  export type Dish_reviewsSumAggregateInputType = {
    rating?: true
    price_cents?: true
  }

  export type Dish_reviewsMinAggregateInputType = {
    id?: true
    dish_id?: true
    comment?: true
    user_id?: true
    rating?: true
    price_cents?: true
    currency_code?: true
    created_dish_media_id?: true
    imported_user_name?: true
    imported_user_avatar?: true
    created_at?: true
  }

  export type Dish_reviewsMaxAggregateInputType = {
    id?: true
    dish_id?: true
    comment?: true
    user_id?: true
    rating?: true
    price_cents?: true
    currency_code?: true
    created_dish_media_id?: true
    imported_user_name?: true
    imported_user_avatar?: true
    created_at?: true
  }

  export type Dish_reviewsCountAggregateInputType = {
    id?: true
    dish_id?: true
    comment?: true
    user_id?: true
    rating?: true
    price_cents?: true
    currency_code?: true
    created_dish_media_id?: true
    imported_user_name?: true
    imported_user_avatar?: true
    created_at?: true
    _all?: true
  }

  export type Dish_reviewsAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which dish_reviews to aggregate.
     */
    where?: dish_reviewsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of dish_reviews to fetch.
     */
    orderBy?: dish_reviewsOrderByWithRelationInput | dish_reviewsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: dish_reviewsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` dish_reviews from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` dish_reviews.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned dish_reviews
    **/
    _count?: true | Dish_reviewsCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: Dish_reviewsAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: Dish_reviewsSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: Dish_reviewsMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: Dish_reviewsMaxAggregateInputType
  }

  export type GetDish_reviewsAggregateType<T extends Dish_reviewsAggregateArgs> = {
        [P in keyof T & keyof AggregateDish_reviews]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateDish_reviews[P]>
      : GetScalarType<T[P], AggregateDish_reviews[P]>
  }




  export type dish_reviewsGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: dish_reviewsWhereInput
    orderBy?: dish_reviewsOrderByWithAggregationInput | dish_reviewsOrderByWithAggregationInput[]
    by: Dish_reviewsScalarFieldEnum[] | Dish_reviewsScalarFieldEnum
    having?: dish_reviewsScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: Dish_reviewsCountAggregateInputType | true
    _avg?: Dish_reviewsAvgAggregateInputType
    _sum?: Dish_reviewsSumAggregateInputType
    _min?: Dish_reviewsMinAggregateInputType
    _max?: Dish_reviewsMaxAggregateInputType
  }

  export type Dish_reviewsGroupByOutputType = {
    id: string
    dish_id: string
    comment: string
    user_id: string | null
    rating: number
    price_cents: number | null
    currency_code: string | null
    created_dish_media_id: string | null
    imported_user_name: string | null
    imported_user_avatar: string | null
    created_at: Date
    _count: Dish_reviewsCountAggregateOutputType | null
    _avg: Dish_reviewsAvgAggregateOutputType | null
    _sum: Dish_reviewsSumAggregateOutputType | null
    _min: Dish_reviewsMinAggregateOutputType | null
    _max: Dish_reviewsMaxAggregateOutputType | null
  }

  type GetDish_reviewsGroupByPayload<T extends dish_reviewsGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<Dish_reviewsGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof Dish_reviewsGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], Dish_reviewsGroupByOutputType[P]>
            : GetScalarType<T[P], Dish_reviewsGroupByOutputType[P]>
        }
      >
    >


  export type dish_reviewsSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    dish_id?: boolean
    comment?: boolean
    user_id?: boolean
    rating?: boolean
    price_cents?: boolean
    currency_code?: boolean
    created_dish_media_id?: boolean
    imported_user_name?: boolean
    imported_user_avatar?: boolean
    created_at?: boolean
    dishes?: boolean | dishesDefaultArgs<ExtArgs>
    users?: boolean | dish_reviews$usersArgs<ExtArgs>
  }, ExtArgs["result"]["dish_reviews"]>

  export type dish_reviewsSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    dish_id?: boolean
    comment?: boolean
    user_id?: boolean
    rating?: boolean
    price_cents?: boolean
    currency_code?: boolean
    created_dish_media_id?: boolean
    imported_user_name?: boolean
    imported_user_avatar?: boolean
    created_at?: boolean
    dishes?: boolean | dishesDefaultArgs<ExtArgs>
    users?: boolean | dish_reviews$usersArgs<ExtArgs>
  }, ExtArgs["result"]["dish_reviews"]>

  export type dish_reviewsSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    dish_id?: boolean
    comment?: boolean
    user_id?: boolean
    rating?: boolean
    price_cents?: boolean
    currency_code?: boolean
    created_dish_media_id?: boolean
    imported_user_name?: boolean
    imported_user_avatar?: boolean
    created_at?: boolean
    dishes?: boolean | dishesDefaultArgs<ExtArgs>
    users?: boolean | dish_reviews$usersArgs<ExtArgs>
  }, ExtArgs["result"]["dish_reviews"]>

  export type dish_reviewsSelectScalar = {
    id?: boolean
    dish_id?: boolean
    comment?: boolean
    user_id?: boolean
    rating?: boolean
    price_cents?: boolean
    currency_code?: boolean
    created_dish_media_id?: boolean
    imported_user_name?: boolean
    imported_user_avatar?: boolean
    created_at?: boolean
  }

  export type dish_reviewsOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "dish_id" | "comment" | "user_id" | "rating" | "price_cents" | "currency_code" | "created_dish_media_id" | "imported_user_name" | "imported_user_avatar" | "created_at", ExtArgs["result"]["dish_reviews"]>
  export type dish_reviewsInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    dishes?: boolean | dishesDefaultArgs<ExtArgs>
    users?: boolean | dish_reviews$usersArgs<ExtArgs>
  }
  export type dish_reviewsIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    dishes?: boolean | dishesDefaultArgs<ExtArgs>
    users?: boolean | dish_reviews$usersArgs<ExtArgs>
  }
  export type dish_reviewsIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    dishes?: boolean | dishesDefaultArgs<ExtArgs>
    users?: boolean | dish_reviews$usersArgs<ExtArgs>
  }

  export type $dish_reviewsPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "dish_reviews"
    objects: {
      dishes: Prisma.$dishesPayload<ExtArgs>
      users: Prisma.$usersPayload<ExtArgs> | null
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      dish_id: string
      comment: string
      user_id: string | null
      rating: number
      price_cents: number | null
      currency_code: string | null
      created_dish_media_id: string | null
      imported_user_name: string | null
      imported_user_avatar: string | null
      created_at: Date
    }, ExtArgs["result"]["dish_reviews"]>
    composites: {}
  }

  type dish_reviewsGetPayload<S extends boolean | null | undefined | dish_reviewsDefaultArgs> = $Result.GetResult<Prisma.$dish_reviewsPayload, S>

  type dish_reviewsCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<dish_reviewsFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: Dish_reviewsCountAggregateInputType | true
    }

  export interface dish_reviewsDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['dish_reviews'], meta: { name: 'dish_reviews' } }
    /**
     * Find zero or one Dish_reviews that matches the filter.
     * @param {dish_reviewsFindUniqueArgs} args - Arguments to find a Dish_reviews
     * @example
     * // Get one Dish_reviews
     * const dish_reviews = await prisma.dish_reviews.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends dish_reviewsFindUniqueArgs>(args: SelectSubset<T, dish_reviewsFindUniqueArgs<ExtArgs>>): Prisma__dish_reviewsClient<$Result.GetResult<Prisma.$dish_reviewsPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one Dish_reviews that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {dish_reviewsFindUniqueOrThrowArgs} args - Arguments to find a Dish_reviews
     * @example
     * // Get one Dish_reviews
     * const dish_reviews = await prisma.dish_reviews.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends dish_reviewsFindUniqueOrThrowArgs>(args: SelectSubset<T, dish_reviewsFindUniqueOrThrowArgs<ExtArgs>>): Prisma__dish_reviewsClient<$Result.GetResult<Prisma.$dish_reviewsPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Dish_reviews that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {dish_reviewsFindFirstArgs} args - Arguments to find a Dish_reviews
     * @example
     * // Get one Dish_reviews
     * const dish_reviews = await prisma.dish_reviews.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends dish_reviewsFindFirstArgs>(args?: SelectSubset<T, dish_reviewsFindFirstArgs<ExtArgs>>): Prisma__dish_reviewsClient<$Result.GetResult<Prisma.$dish_reviewsPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Dish_reviews that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {dish_reviewsFindFirstOrThrowArgs} args - Arguments to find a Dish_reviews
     * @example
     * // Get one Dish_reviews
     * const dish_reviews = await prisma.dish_reviews.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends dish_reviewsFindFirstOrThrowArgs>(args?: SelectSubset<T, dish_reviewsFindFirstOrThrowArgs<ExtArgs>>): Prisma__dish_reviewsClient<$Result.GetResult<Prisma.$dish_reviewsPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more Dish_reviews that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {dish_reviewsFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Dish_reviews
     * const dish_reviews = await prisma.dish_reviews.findMany()
     * 
     * // Get first 10 Dish_reviews
     * const dish_reviews = await prisma.dish_reviews.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const dish_reviewsWithIdOnly = await prisma.dish_reviews.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends dish_reviewsFindManyArgs>(args?: SelectSubset<T, dish_reviewsFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$dish_reviewsPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a Dish_reviews.
     * @param {dish_reviewsCreateArgs} args - Arguments to create a Dish_reviews.
     * @example
     * // Create one Dish_reviews
     * const Dish_reviews = await prisma.dish_reviews.create({
     *   data: {
     *     // ... data to create a Dish_reviews
     *   }
     * })
     * 
     */
    create<T extends dish_reviewsCreateArgs>(args: SelectSubset<T, dish_reviewsCreateArgs<ExtArgs>>): Prisma__dish_reviewsClient<$Result.GetResult<Prisma.$dish_reviewsPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many Dish_reviews.
     * @param {dish_reviewsCreateManyArgs} args - Arguments to create many Dish_reviews.
     * @example
     * // Create many Dish_reviews
     * const dish_reviews = await prisma.dish_reviews.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends dish_reviewsCreateManyArgs>(args?: SelectSubset<T, dish_reviewsCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Dish_reviews and returns the data saved in the database.
     * @param {dish_reviewsCreateManyAndReturnArgs} args - Arguments to create many Dish_reviews.
     * @example
     * // Create many Dish_reviews
     * const dish_reviews = await prisma.dish_reviews.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Dish_reviews and only return the `id`
     * const dish_reviewsWithIdOnly = await prisma.dish_reviews.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends dish_reviewsCreateManyAndReturnArgs>(args?: SelectSubset<T, dish_reviewsCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$dish_reviewsPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a Dish_reviews.
     * @param {dish_reviewsDeleteArgs} args - Arguments to delete one Dish_reviews.
     * @example
     * // Delete one Dish_reviews
     * const Dish_reviews = await prisma.dish_reviews.delete({
     *   where: {
     *     // ... filter to delete one Dish_reviews
     *   }
     * })
     * 
     */
    delete<T extends dish_reviewsDeleteArgs>(args: SelectSubset<T, dish_reviewsDeleteArgs<ExtArgs>>): Prisma__dish_reviewsClient<$Result.GetResult<Prisma.$dish_reviewsPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one Dish_reviews.
     * @param {dish_reviewsUpdateArgs} args - Arguments to update one Dish_reviews.
     * @example
     * // Update one Dish_reviews
     * const dish_reviews = await prisma.dish_reviews.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends dish_reviewsUpdateArgs>(args: SelectSubset<T, dish_reviewsUpdateArgs<ExtArgs>>): Prisma__dish_reviewsClient<$Result.GetResult<Prisma.$dish_reviewsPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more Dish_reviews.
     * @param {dish_reviewsDeleteManyArgs} args - Arguments to filter Dish_reviews to delete.
     * @example
     * // Delete a few Dish_reviews
     * const { count } = await prisma.dish_reviews.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends dish_reviewsDeleteManyArgs>(args?: SelectSubset<T, dish_reviewsDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Dish_reviews.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {dish_reviewsUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Dish_reviews
     * const dish_reviews = await prisma.dish_reviews.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends dish_reviewsUpdateManyArgs>(args: SelectSubset<T, dish_reviewsUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Dish_reviews and returns the data updated in the database.
     * @param {dish_reviewsUpdateManyAndReturnArgs} args - Arguments to update many Dish_reviews.
     * @example
     * // Update many Dish_reviews
     * const dish_reviews = await prisma.dish_reviews.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more Dish_reviews and only return the `id`
     * const dish_reviewsWithIdOnly = await prisma.dish_reviews.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends dish_reviewsUpdateManyAndReturnArgs>(args: SelectSubset<T, dish_reviewsUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$dish_reviewsPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one Dish_reviews.
     * @param {dish_reviewsUpsertArgs} args - Arguments to update or create a Dish_reviews.
     * @example
     * // Update or create a Dish_reviews
     * const dish_reviews = await prisma.dish_reviews.upsert({
     *   create: {
     *     // ... data to create a Dish_reviews
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Dish_reviews we want to update
     *   }
     * })
     */
    upsert<T extends dish_reviewsUpsertArgs>(args: SelectSubset<T, dish_reviewsUpsertArgs<ExtArgs>>): Prisma__dish_reviewsClient<$Result.GetResult<Prisma.$dish_reviewsPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of Dish_reviews.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {dish_reviewsCountArgs} args - Arguments to filter Dish_reviews to count.
     * @example
     * // Count the number of Dish_reviews
     * const count = await prisma.dish_reviews.count({
     *   where: {
     *     // ... the filter for the Dish_reviews we want to count
     *   }
     * })
    **/
    count<T extends dish_reviewsCountArgs>(
      args?: Subset<T, dish_reviewsCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], Dish_reviewsCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Dish_reviews.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Dish_reviewsAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends Dish_reviewsAggregateArgs>(args: Subset<T, Dish_reviewsAggregateArgs>): Prisma.PrismaPromise<GetDish_reviewsAggregateType<T>>

    /**
     * Group by Dish_reviews.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {dish_reviewsGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends dish_reviewsGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: dish_reviewsGroupByArgs['orderBy'] }
        : { orderBy?: dish_reviewsGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, dish_reviewsGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetDish_reviewsGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the dish_reviews model
   */
  readonly fields: dish_reviewsFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for dish_reviews.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__dish_reviewsClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    dishes<T extends dishesDefaultArgs<ExtArgs> = {}>(args?: Subset<T, dishesDefaultArgs<ExtArgs>>): Prisma__dishesClient<$Result.GetResult<Prisma.$dishesPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    users<T extends dish_reviews$usersArgs<ExtArgs> = {}>(args?: Subset<T, dish_reviews$usersArgs<ExtArgs>>): Prisma__usersClient<$Result.GetResult<Prisma.$usersPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the dish_reviews model
   */
  interface dish_reviewsFieldRefs {
    readonly id: FieldRef<"dish_reviews", 'String'>
    readonly dish_id: FieldRef<"dish_reviews", 'String'>
    readonly comment: FieldRef<"dish_reviews", 'String'>
    readonly user_id: FieldRef<"dish_reviews", 'String'>
    readonly rating: FieldRef<"dish_reviews", 'Int'>
    readonly price_cents: FieldRef<"dish_reviews", 'Int'>
    readonly currency_code: FieldRef<"dish_reviews", 'String'>
    readonly created_dish_media_id: FieldRef<"dish_reviews", 'String'>
    readonly imported_user_name: FieldRef<"dish_reviews", 'String'>
    readonly imported_user_avatar: FieldRef<"dish_reviews", 'String'>
    readonly created_at: FieldRef<"dish_reviews", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * dish_reviews findUnique
   */
  export type dish_reviewsFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_reviews
     */
    select?: dish_reviewsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_reviews
     */
    omit?: dish_reviewsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_reviewsInclude<ExtArgs> | null
    /**
     * Filter, which dish_reviews to fetch.
     */
    where: dish_reviewsWhereUniqueInput
  }

  /**
   * dish_reviews findUniqueOrThrow
   */
  export type dish_reviewsFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_reviews
     */
    select?: dish_reviewsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_reviews
     */
    omit?: dish_reviewsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_reviewsInclude<ExtArgs> | null
    /**
     * Filter, which dish_reviews to fetch.
     */
    where: dish_reviewsWhereUniqueInput
  }

  /**
   * dish_reviews findFirst
   */
  export type dish_reviewsFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_reviews
     */
    select?: dish_reviewsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_reviews
     */
    omit?: dish_reviewsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_reviewsInclude<ExtArgs> | null
    /**
     * Filter, which dish_reviews to fetch.
     */
    where?: dish_reviewsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of dish_reviews to fetch.
     */
    orderBy?: dish_reviewsOrderByWithRelationInput | dish_reviewsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for dish_reviews.
     */
    cursor?: dish_reviewsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` dish_reviews from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` dish_reviews.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of dish_reviews.
     */
    distinct?: Dish_reviewsScalarFieldEnum | Dish_reviewsScalarFieldEnum[]
  }

  /**
   * dish_reviews findFirstOrThrow
   */
  export type dish_reviewsFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_reviews
     */
    select?: dish_reviewsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_reviews
     */
    omit?: dish_reviewsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_reviewsInclude<ExtArgs> | null
    /**
     * Filter, which dish_reviews to fetch.
     */
    where?: dish_reviewsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of dish_reviews to fetch.
     */
    orderBy?: dish_reviewsOrderByWithRelationInput | dish_reviewsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for dish_reviews.
     */
    cursor?: dish_reviewsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` dish_reviews from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` dish_reviews.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of dish_reviews.
     */
    distinct?: Dish_reviewsScalarFieldEnum | Dish_reviewsScalarFieldEnum[]
  }

  /**
   * dish_reviews findMany
   */
  export type dish_reviewsFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_reviews
     */
    select?: dish_reviewsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_reviews
     */
    omit?: dish_reviewsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_reviewsInclude<ExtArgs> | null
    /**
     * Filter, which dish_reviews to fetch.
     */
    where?: dish_reviewsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of dish_reviews to fetch.
     */
    orderBy?: dish_reviewsOrderByWithRelationInput | dish_reviewsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing dish_reviews.
     */
    cursor?: dish_reviewsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` dish_reviews from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` dish_reviews.
     */
    skip?: number
    distinct?: Dish_reviewsScalarFieldEnum | Dish_reviewsScalarFieldEnum[]
  }

  /**
   * dish_reviews create
   */
  export type dish_reviewsCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_reviews
     */
    select?: dish_reviewsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_reviews
     */
    omit?: dish_reviewsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_reviewsInclude<ExtArgs> | null
    /**
     * The data needed to create a dish_reviews.
     */
    data: XOR<dish_reviewsCreateInput, dish_reviewsUncheckedCreateInput>
  }

  /**
   * dish_reviews createMany
   */
  export type dish_reviewsCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many dish_reviews.
     */
    data: dish_reviewsCreateManyInput | dish_reviewsCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * dish_reviews createManyAndReturn
   */
  export type dish_reviewsCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_reviews
     */
    select?: dish_reviewsSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the dish_reviews
     */
    omit?: dish_reviewsOmit<ExtArgs> | null
    /**
     * The data used to create many dish_reviews.
     */
    data: dish_reviewsCreateManyInput | dish_reviewsCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_reviewsIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * dish_reviews update
   */
  export type dish_reviewsUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_reviews
     */
    select?: dish_reviewsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_reviews
     */
    omit?: dish_reviewsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_reviewsInclude<ExtArgs> | null
    /**
     * The data needed to update a dish_reviews.
     */
    data: XOR<dish_reviewsUpdateInput, dish_reviewsUncheckedUpdateInput>
    /**
     * Choose, which dish_reviews to update.
     */
    where: dish_reviewsWhereUniqueInput
  }

  /**
   * dish_reviews updateMany
   */
  export type dish_reviewsUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update dish_reviews.
     */
    data: XOR<dish_reviewsUpdateManyMutationInput, dish_reviewsUncheckedUpdateManyInput>
    /**
     * Filter which dish_reviews to update
     */
    where?: dish_reviewsWhereInput
    /**
     * Limit how many dish_reviews to update.
     */
    limit?: number
  }

  /**
   * dish_reviews updateManyAndReturn
   */
  export type dish_reviewsUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_reviews
     */
    select?: dish_reviewsSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the dish_reviews
     */
    omit?: dish_reviewsOmit<ExtArgs> | null
    /**
     * The data used to update dish_reviews.
     */
    data: XOR<dish_reviewsUpdateManyMutationInput, dish_reviewsUncheckedUpdateManyInput>
    /**
     * Filter which dish_reviews to update
     */
    where?: dish_reviewsWhereInput
    /**
     * Limit how many dish_reviews to update.
     */
    limit?: number
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_reviewsIncludeUpdateManyAndReturn<ExtArgs> | null
  }

  /**
   * dish_reviews upsert
   */
  export type dish_reviewsUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_reviews
     */
    select?: dish_reviewsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_reviews
     */
    omit?: dish_reviewsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_reviewsInclude<ExtArgs> | null
    /**
     * The filter to search for the dish_reviews to update in case it exists.
     */
    where: dish_reviewsWhereUniqueInput
    /**
     * In case the dish_reviews found by the `where` argument doesn't exist, create a new dish_reviews with this data.
     */
    create: XOR<dish_reviewsCreateInput, dish_reviewsUncheckedCreateInput>
    /**
     * In case the dish_reviews was found with the provided `where` argument, update it with this data.
     */
    update: XOR<dish_reviewsUpdateInput, dish_reviewsUncheckedUpdateInput>
  }

  /**
   * dish_reviews delete
   */
  export type dish_reviewsDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_reviews
     */
    select?: dish_reviewsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_reviews
     */
    omit?: dish_reviewsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_reviewsInclude<ExtArgs> | null
    /**
     * Filter which dish_reviews to delete.
     */
    where: dish_reviewsWhereUniqueInput
  }

  /**
   * dish_reviews deleteMany
   */
  export type dish_reviewsDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which dish_reviews to delete
     */
    where?: dish_reviewsWhereInput
    /**
     * Limit how many dish_reviews to delete.
     */
    limit?: number
  }

  /**
   * dish_reviews.users
   */
  export type dish_reviews$usersArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the users
     */
    select?: usersSelect<ExtArgs> | null
    /**
     * Omit specific fields from the users
     */
    omit?: usersOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: usersInclude<ExtArgs> | null
    where?: usersWhereInput
  }

  /**
   * dish_reviews without action
   */
  export type dish_reviewsDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_reviews
     */
    select?: dish_reviewsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_reviews
     */
    omit?: dish_reviewsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_reviewsInclude<ExtArgs> | null
  }


  /**
   * Model dishes
   */

  export type AggregateDishes = {
    _count: DishesCountAggregateOutputType | null
    _avg: DishesAvgAggregateOutputType | null
    _sum: DishesSumAggregateOutputType | null
    _min: DishesMinAggregateOutputType | null
    _max: DishesMaxAggregateOutputType | null
  }

  export type DishesAvgAggregateOutputType = {
    lock_no: number | null
  }

  export type DishesSumAggregateOutputType = {
    lock_no: number | null
  }

  export type DishesMinAggregateOutputType = {
    id: string | null
    restaurant_id: string | null
    category_id: string | null
    name: string | null
    created_at: Date | null
    updated_at: Date | null
    lock_no: number | null
  }

  export type DishesMaxAggregateOutputType = {
    id: string | null
    restaurant_id: string | null
    category_id: string | null
    name: string | null
    created_at: Date | null
    updated_at: Date | null
    lock_no: number | null
  }

  export type DishesCountAggregateOutputType = {
    id: number
    restaurant_id: number
    category_id: number
    name: number
    created_at: number
    updated_at: number
    lock_no: number
    _all: number
  }


  export type DishesAvgAggregateInputType = {
    lock_no?: true
  }

  export type DishesSumAggregateInputType = {
    lock_no?: true
  }

  export type DishesMinAggregateInputType = {
    id?: true
    restaurant_id?: true
    category_id?: true
    name?: true
    created_at?: true
    updated_at?: true
    lock_no?: true
  }

  export type DishesMaxAggregateInputType = {
    id?: true
    restaurant_id?: true
    category_id?: true
    name?: true
    created_at?: true
    updated_at?: true
    lock_no?: true
  }

  export type DishesCountAggregateInputType = {
    id?: true
    restaurant_id?: true
    category_id?: true
    name?: true
    created_at?: true
    updated_at?: true
    lock_no?: true
    _all?: true
  }

  export type DishesAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which dishes to aggregate.
     */
    where?: dishesWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of dishes to fetch.
     */
    orderBy?: dishesOrderByWithRelationInput | dishesOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: dishesWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` dishes from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` dishes.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned dishes
    **/
    _count?: true | DishesCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: DishesAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: DishesSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: DishesMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: DishesMaxAggregateInputType
  }

  export type GetDishesAggregateType<T extends DishesAggregateArgs> = {
        [P in keyof T & keyof AggregateDishes]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateDishes[P]>
      : GetScalarType<T[P], AggregateDishes[P]>
  }




  export type dishesGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: dishesWhereInput
    orderBy?: dishesOrderByWithAggregationInput | dishesOrderByWithAggregationInput[]
    by: DishesScalarFieldEnum[] | DishesScalarFieldEnum
    having?: dishesScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: DishesCountAggregateInputType | true
    _avg?: DishesAvgAggregateInputType
    _sum?: DishesSumAggregateInputType
    _min?: DishesMinAggregateInputType
    _max?: DishesMaxAggregateInputType
  }

  export type DishesGroupByOutputType = {
    id: string
    restaurant_id: string | null
    category_id: string
    name: string | null
    created_at: Date
    updated_at: Date
    lock_no: number
    _count: DishesCountAggregateOutputType | null
    _avg: DishesAvgAggregateOutputType | null
    _sum: DishesSumAggregateOutputType | null
    _min: DishesMinAggregateOutputType | null
    _max: DishesMaxAggregateOutputType | null
  }

  type GetDishesGroupByPayload<T extends dishesGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<DishesGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof DishesGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], DishesGroupByOutputType[P]>
            : GetScalarType<T[P], DishesGroupByOutputType[P]>
        }
      >
    >


  export type dishesSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    restaurant_id?: boolean
    category_id?: boolean
    name?: boolean
    created_at?: boolean
    updated_at?: boolean
    lock_no?: boolean
    dish_media?: boolean | dishes$dish_mediaArgs<ExtArgs>
    dish_reviews?: boolean | dishes$dish_reviewsArgs<ExtArgs>
    dish_categories?: boolean | dish_categoriesDefaultArgs<ExtArgs>
    restaurants?: boolean | dishes$restaurantsArgs<ExtArgs>
    _count?: boolean | DishesCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["dishes"]>

  export type dishesSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    restaurant_id?: boolean
    category_id?: boolean
    name?: boolean
    created_at?: boolean
    updated_at?: boolean
    lock_no?: boolean
    dish_categories?: boolean | dish_categoriesDefaultArgs<ExtArgs>
    restaurants?: boolean | dishes$restaurantsArgs<ExtArgs>
  }, ExtArgs["result"]["dishes"]>

  export type dishesSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    restaurant_id?: boolean
    category_id?: boolean
    name?: boolean
    created_at?: boolean
    updated_at?: boolean
    lock_no?: boolean
    dish_categories?: boolean | dish_categoriesDefaultArgs<ExtArgs>
    restaurants?: boolean | dishes$restaurantsArgs<ExtArgs>
  }, ExtArgs["result"]["dishes"]>

  export type dishesSelectScalar = {
    id?: boolean
    restaurant_id?: boolean
    category_id?: boolean
    name?: boolean
    created_at?: boolean
    updated_at?: boolean
    lock_no?: boolean
  }

  export type dishesOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "restaurant_id" | "category_id" | "name" | "created_at" | "updated_at" | "lock_no", ExtArgs["result"]["dishes"]>
  export type dishesInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    dish_media?: boolean | dishes$dish_mediaArgs<ExtArgs>
    dish_reviews?: boolean | dishes$dish_reviewsArgs<ExtArgs>
    dish_categories?: boolean | dish_categoriesDefaultArgs<ExtArgs>
    restaurants?: boolean | dishes$restaurantsArgs<ExtArgs>
    _count?: boolean | DishesCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type dishesIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    dish_categories?: boolean | dish_categoriesDefaultArgs<ExtArgs>
    restaurants?: boolean | dishes$restaurantsArgs<ExtArgs>
  }
  export type dishesIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    dish_categories?: boolean | dish_categoriesDefaultArgs<ExtArgs>
    restaurants?: boolean | dishes$restaurantsArgs<ExtArgs>
  }

  export type $dishesPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "dishes"
    objects: {
      dish_media: Prisma.$dish_mediaPayload<ExtArgs>[]
      dish_reviews: Prisma.$dish_reviewsPayload<ExtArgs>[]
      dish_categories: Prisma.$dish_categoriesPayload<ExtArgs>
      restaurants: Prisma.$restaurantsPayload<ExtArgs> | null
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      restaurant_id: string | null
      category_id: string
      name: string | null
      created_at: Date
      updated_at: Date
      lock_no: number
    }, ExtArgs["result"]["dishes"]>
    composites: {}
  }

  type dishesGetPayload<S extends boolean | null | undefined | dishesDefaultArgs> = $Result.GetResult<Prisma.$dishesPayload, S>

  type dishesCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<dishesFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: DishesCountAggregateInputType | true
    }

  export interface dishesDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['dishes'], meta: { name: 'dishes' } }
    /**
     * Find zero or one Dishes that matches the filter.
     * @param {dishesFindUniqueArgs} args - Arguments to find a Dishes
     * @example
     * // Get one Dishes
     * const dishes = await prisma.dishes.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends dishesFindUniqueArgs>(args: SelectSubset<T, dishesFindUniqueArgs<ExtArgs>>): Prisma__dishesClient<$Result.GetResult<Prisma.$dishesPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one Dishes that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {dishesFindUniqueOrThrowArgs} args - Arguments to find a Dishes
     * @example
     * // Get one Dishes
     * const dishes = await prisma.dishes.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends dishesFindUniqueOrThrowArgs>(args: SelectSubset<T, dishesFindUniqueOrThrowArgs<ExtArgs>>): Prisma__dishesClient<$Result.GetResult<Prisma.$dishesPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Dishes that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {dishesFindFirstArgs} args - Arguments to find a Dishes
     * @example
     * // Get one Dishes
     * const dishes = await prisma.dishes.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends dishesFindFirstArgs>(args?: SelectSubset<T, dishesFindFirstArgs<ExtArgs>>): Prisma__dishesClient<$Result.GetResult<Prisma.$dishesPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Dishes that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {dishesFindFirstOrThrowArgs} args - Arguments to find a Dishes
     * @example
     * // Get one Dishes
     * const dishes = await prisma.dishes.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends dishesFindFirstOrThrowArgs>(args?: SelectSubset<T, dishesFindFirstOrThrowArgs<ExtArgs>>): Prisma__dishesClient<$Result.GetResult<Prisma.$dishesPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more Dishes that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {dishesFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Dishes
     * const dishes = await prisma.dishes.findMany()
     * 
     * // Get first 10 Dishes
     * const dishes = await prisma.dishes.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const dishesWithIdOnly = await prisma.dishes.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends dishesFindManyArgs>(args?: SelectSubset<T, dishesFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$dishesPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a Dishes.
     * @param {dishesCreateArgs} args - Arguments to create a Dishes.
     * @example
     * // Create one Dishes
     * const Dishes = await prisma.dishes.create({
     *   data: {
     *     // ... data to create a Dishes
     *   }
     * })
     * 
     */
    create<T extends dishesCreateArgs>(args: SelectSubset<T, dishesCreateArgs<ExtArgs>>): Prisma__dishesClient<$Result.GetResult<Prisma.$dishesPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many Dishes.
     * @param {dishesCreateManyArgs} args - Arguments to create many Dishes.
     * @example
     * // Create many Dishes
     * const dishes = await prisma.dishes.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends dishesCreateManyArgs>(args?: SelectSubset<T, dishesCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Dishes and returns the data saved in the database.
     * @param {dishesCreateManyAndReturnArgs} args - Arguments to create many Dishes.
     * @example
     * // Create many Dishes
     * const dishes = await prisma.dishes.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Dishes and only return the `id`
     * const dishesWithIdOnly = await prisma.dishes.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends dishesCreateManyAndReturnArgs>(args?: SelectSubset<T, dishesCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$dishesPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a Dishes.
     * @param {dishesDeleteArgs} args - Arguments to delete one Dishes.
     * @example
     * // Delete one Dishes
     * const Dishes = await prisma.dishes.delete({
     *   where: {
     *     // ... filter to delete one Dishes
     *   }
     * })
     * 
     */
    delete<T extends dishesDeleteArgs>(args: SelectSubset<T, dishesDeleteArgs<ExtArgs>>): Prisma__dishesClient<$Result.GetResult<Prisma.$dishesPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one Dishes.
     * @param {dishesUpdateArgs} args - Arguments to update one Dishes.
     * @example
     * // Update one Dishes
     * const dishes = await prisma.dishes.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends dishesUpdateArgs>(args: SelectSubset<T, dishesUpdateArgs<ExtArgs>>): Prisma__dishesClient<$Result.GetResult<Prisma.$dishesPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more Dishes.
     * @param {dishesDeleteManyArgs} args - Arguments to filter Dishes to delete.
     * @example
     * // Delete a few Dishes
     * const { count } = await prisma.dishes.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends dishesDeleteManyArgs>(args?: SelectSubset<T, dishesDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Dishes.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {dishesUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Dishes
     * const dishes = await prisma.dishes.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends dishesUpdateManyArgs>(args: SelectSubset<T, dishesUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Dishes and returns the data updated in the database.
     * @param {dishesUpdateManyAndReturnArgs} args - Arguments to update many Dishes.
     * @example
     * // Update many Dishes
     * const dishes = await prisma.dishes.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more Dishes and only return the `id`
     * const dishesWithIdOnly = await prisma.dishes.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends dishesUpdateManyAndReturnArgs>(args: SelectSubset<T, dishesUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$dishesPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one Dishes.
     * @param {dishesUpsertArgs} args - Arguments to update or create a Dishes.
     * @example
     * // Update or create a Dishes
     * const dishes = await prisma.dishes.upsert({
     *   create: {
     *     // ... data to create a Dishes
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Dishes we want to update
     *   }
     * })
     */
    upsert<T extends dishesUpsertArgs>(args: SelectSubset<T, dishesUpsertArgs<ExtArgs>>): Prisma__dishesClient<$Result.GetResult<Prisma.$dishesPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of Dishes.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {dishesCountArgs} args - Arguments to filter Dishes to count.
     * @example
     * // Count the number of Dishes
     * const count = await prisma.dishes.count({
     *   where: {
     *     // ... the filter for the Dishes we want to count
     *   }
     * })
    **/
    count<T extends dishesCountArgs>(
      args?: Subset<T, dishesCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], DishesCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Dishes.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {DishesAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends DishesAggregateArgs>(args: Subset<T, DishesAggregateArgs>): Prisma.PrismaPromise<GetDishesAggregateType<T>>

    /**
     * Group by Dishes.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {dishesGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends dishesGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: dishesGroupByArgs['orderBy'] }
        : { orderBy?: dishesGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, dishesGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetDishesGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the dishes model
   */
  readonly fields: dishesFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for dishes.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__dishesClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    dish_media<T extends dishes$dish_mediaArgs<ExtArgs> = {}>(args?: Subset<T, dishes$dish_mediaArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$dish_mediaPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    dish_reviews<T extends dishes$dish_reviewsArgs<ExtArgs> = {}>(args?: Subset<T, dishes$dish_reviewsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$dish_reviewsPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    dish_categories<T extends dish_categoriesDefaultArgs<ExtArgs> = {}>(args?: Subset<T, dish_categoriesDefaultArgs<ExtArgs>>): Prisma__dish_categoriesClient<$Result.GetResult<Prisma.$dish_categoriesPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    restaurants<T extends dishes$restaurantsArgs<ExtArgs> = {}>(args?: Subset<T, dishes$restaurantsArgs<ExtArgs>>): Prisma__restaurantsClient<$Result.GetResult<Prisma.$restaurantsPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the dishes model
   */
  interface dishesFieldRefs {
    readonly id: FieldRef<"dishes", 'String'>
    readonly restaurant_id: FieldRef<"dishes", 'String'>
    readonly category_id: FieldRef<"dishes", 'String'>
    readonly name: FieldRef<"dishes", 'String'>
    readonly created_at: FieldRef<"dishes", 'DateTime'>
    readonly updated_at: FieldRef<"dishes", 'DateTime'>
    readonly lock_no: FieldRef<"dishes", 'Int'>
  }
    

  // Custom InputTypes
  /**
   * dishes findUnique
   */
  export type dishesFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dishes
     */
    select?: dishesSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dishes
     */
    omit?: dishesOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dishesInclude<ExtArgs> | null
    /**
     * Filter, which dishes to fetch.
     */
    where: dishesWhereUniqueInput
  }

  /**
   * dishes findUniqueOrThrow
   */
  export type dishesFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dishes
     */
    select?: dishesSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dishes
     */
    omit?: dishesOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dishesInclude<ExtArgs> | null
    /**
     * Filter, which dishes to fetch.
     */
    where: dishesWhereUniqueInput
  }

  /**
   * dishes findFirst
   */
  export type dishesFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dishes
     */
    select?: dishesSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dishes
     */
    omit?: dishesOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dishesInclude<ExtArgs> | null
    /**
     * Filter, which dishes to fetch.
     */
    where?: dishesWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of dishes to fetch.
     */
    orderBy?: dishesOrderByWithRelationInput | dishesOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for dishes.
     */
    cursor?: dishesWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` dishes from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` dishes.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of dishes.
     */
    distinct?: DishesScalarFieldEnum | DishesScalarFieldEnum[]
  }

  /**
   * dishes findFirstOrThrow
   */
  export type dishesFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dishes
     */
    select?: dishesSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dishes
     */
    omit?: dishesOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dishesInclude<ExtArgs> | null
    /**
     * Filter, which dishes to fetch.
     */
    where?: dishesWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of dishes to fetch.
     */
    orderBy?: dishesOrderByWithRelationInput | dishesOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for dishes.
     */
    cursor?: dishesWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` dishes from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` dishes.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of dishes.
     */
    distinct?: DishesScalarFieldEnum | DishesScalarFieldEnum[]
  }

  /**
   * dishes findMany
   */
  export type dishesFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dishes
     */
    select?: dishesSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dishes
     */
    omit?: dishesOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dishesInclude<ExtArgs> | null
    /**
     * Filter, which dishes to fetch.
     */
    where?: dishesWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of dishes to fetch.
     */
    orderBy?: dishesOrderByWithRelationInput | dishesOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing dishes.
     */
    cursor?: dishesWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` dishes from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` dishes.
     */
    skip?: number
    distinct?: DishesScalarFieldEnum | DishesScalarFieldEnum[]
  }

  /**
   * dishes create
   */
  export type dishesCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dishes
     */
    select?: dishesSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dishes
     */
    omit?: dishesOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dishesInclude<ExtArgs> | null
    /**
     * The data needed to create a dishes.
     */
    data: XOR<dishesCreateInput, dishesUncheckedCreateInput>
  }

  /**
   * dishes createMany
   */
  export type dishesCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many dishes.
     */
    data: dishesCreateManyInput | dishesCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * dishes createManyAndReturn
   */
  export type dishesCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dishes
     */
    select?: dishesSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the dishes
     */
    omit?: dishesOmit<ExtArgs> | null
    /**
     * The data used to create many dishes.
     */
    data: dishesCreateManyInput | dishesCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dishesIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * dishes update
   */
  export type dishesUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dishes
     */
    select?: dishesSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dishes
     */
    omit?: dishesOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dishesInclude<ExtArgs> | null
    /**
     * The data needed to update a dishes.
     */
    data: XOR<dishesUpdateInput, dishesUncheckedUpdateInput>
    /**
     * Choose, which dishes to update.
     */
    where: dishesWhereUniqueInput
  }

  /**
   * dishes updateMany
   */
  export type dishesUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update dishes.
     */
    data: XOR<dishesUpdateManyMutationInput, dishesUncheckedUpdateManyInput>
    /**
     * Filter which dishes to update
     */
    where?: dishesWhereInput
    /**
     * Limit how many dishes to update.
     */
    limit?: number
  }

  /**
   * dishes updateManyAndReturn
   */
  export type dishesUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dishes
     */
    select?: dishesSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the dishes
     */
    omit?: dishesOmit<ExtArgs> | null
    /**
     * The data used to update dishes.
     */
    data: XOR<dishesUpdateManyMutationInput, dishesUncheckedUpdateManyInput>
    /**
     * Filter which dishes to update
     */
    where?: dishesWhereInput
    /**
     * Limit how many dishes to update.
     */
    limit?: number
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dishesIncludeUpdateManyAndReturn<ExtArgs> | null
  }

  /**
   * dishes upsert
   */
  export type dishesUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dishes
     */
    select?: dishesSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dishes
     */
    omit?: dishesOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dishesInclude<ExtArgs> | null
    /**
     * The filter to search for the dishes to update in case it exists.
     */
    where: dishesWhereUniqueInput
    /**
     * In case the dishes found by the `where` argument doesn't exist, create a new dishes with this data.
     */
    create: XOR<dishesCreateInput, dishesUncheckedCreateInput>
    /**
     * In case the dishes was found with the provided `where` argument, update it with this data.
     */
    update: XOR<dishesUpdateInput, dishesUncheckedUpdateInput>
  }

  /**
   * dishes delete
   */
  export type dishesDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dishes
     */
    select?: dishesSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dishes
     */
    omit?: dishesOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dishesInclude<ExtArgs> | null
    /**
     * Filter which dishes to delete.
     */
    where: dishesWhereUniqueInput
  }

  /**
   * dishes deleteMany
   */
  export type dishesDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which dishes to delete
     */
    where?: dishesWhereInput
    /**
     * Limit how many dishes to delete.
     */
    limit?: number
  }

  /**
   * dishes.dish_media
   */
  export type dishes$dish_mediaArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_media
     */
    select?: dish_mediaSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_media
     */
    omit?: dish_mediaOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_mediaInclude<ExtArgs> | null
    where?: dish_mediaWhereInput
    orderBy?: dish_mediaOrderByWithRelationInput | dish_mediaOrderByWithRelationInput[]
    cursor?: dish_mediaWhereUniqueInput
    take?: number
    skip?: number
    distinct?: Dish_mediaScalarFieldEnum | Dish_mediaScalarFieldEnum[]
  }

  /**
   * dishes.dish_reviews
   */
  export type dishes$dish_reviewsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_reviews
     */
    select?: dish_reviewsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_reviews
     */
    omit?: dish_reviewsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_reviewsInclude<ExtArgs> | null
    where?: dish_reviewsWhereInput
    orderBy?: dish_reviewsOrderByWithRelationInput | dish_reviewsOrderByWithRelationInput[]
    cursor?: dish_reviewsWhereUniqueInput
    take?: number
    skip?: number
    distinct?: Dish_reviewsScalarFieldEnum | Dish_reviewsScalarFieldEnum[]
  }

  /**
   * dishes.restaurants
   */
  export type dishes$restaurantsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the restaurants
     */
    select?: restaurantsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the restaurants
     */
    omit?: restaurantsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: restaurantsInclude<ExtArgs> | null
    where?: restaurantsWhereInput
  }

  /**
   * dishes without action
   */
  export type dishesDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dishes
     */
    select?: dishesSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dishes
     */
    omit?: dishesOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dishesInclude<ExtArgs> | null
  }


  /**
   * Model payouts
   */

  export type AggregatePayouts = {
    _count: PayoutsCountAggregateOutputType | null
    _avg: PayoutsAvgAggregateOutputType | null
    _sum: PayoutsSumAggregateOutputType | null
    _min: PayoutsMinAggregateOutputType | null
    _max: PayoutsMaxAggregateOutputType | null
  }

  export type PayoutsAvgAggregateOutputType = {
    amount_cents: number | null
    lock_no: number | null
  }

  export type PayoutsSumAggregateOutputType = {
    amount_cents: bigint | null
    lock_no: number | null
  }

  export type PayoutsMinAggregateOutputType = {
    id: string | null
    bid_id: string | null
    transfer_id: string | null
    dish_media_id: string | null
    amount_cents: bigint | null
    currency_code: string | null
    status: $Enums.payout_status | null
    created_at: Date | null
    updated_at: Date | null
    lock_no: number | null
  }

  export type PayoutsMaxAggregateOutputType = {
    id: string | null
    bid_id: string | null
    transfer_id: string | null
    dish_media_id: string | null
    amount_cents: bigint | null
    currency_code: string | null
    status: $Enums.payout_status | null
    created_at: Date | null
    updated_at: Date | null
    lock_no: number | null
  }

  export type PayoutsCountAggregateOutputType = {
    id: number
    bid_id: number
    transfer_id: number
    dish_media_id: number
    amount_cents: number
    currency_code: number
    status: number
    created_at: number
    updated_at: number
    lock_no: number
    _all: number
  }


  export type PayoutsAvgAggregateInputType = {
    amount_cents?: true
    lock_no?: true
  }

  export type PayoutsSumAggregateInputType = {
    amount_cents?: true
    lock_no?: true
  }

  export type PayoutsMinAggregateInputType = {
    id?: true
    bid_id?: true
    transfer_id?: true
    dish_media_id?: true
    amount_cents?: true
    currency_code?: true
    status?: true
    created_at?: true
    updated_at?: true
    lock_no?: true
  }

  export type PayoutsMaxAggregateInputType = {
    id?: true
    bid_id?: true
    transfer_id?: true
    dish_media_id?: true
    amount_cents?: true
    currency_code?: true
    status?: true
    created_at?: true
    updated_at?: true
    lock_no?: true
  }

  export type PayoutsCountAggregateInputType = {
    id?: true
    bid_id?: true
    transfer_id?: true
    dish_media_id?: true
    amount_cents?: true
    currency_code?: true
    status?: true
    created_at?: true
    updated_at?: true
    lock_no?: true
    _all?: true
  }

  export type PayoutsAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which payouts to aggregate.
     */
    where?: payoutsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of payouts to fetch.
     */
    orderBy?: payoutsOrderByWithRelationInput | payoutsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: payoutsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` payouts from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` payouts.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned payouts
    **/
    _count?: true | PayoutsCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: PayoutsAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: PayoutsSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: PayoutsMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: PayoutsMaxAggregateInputType
  }

  export type GetPayoutsAggregateType<T extends PayoutsAggregateArgs> = {
        [P in keyof T & keyof AggregatePayouts]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregatePayouts[P]>
      : GetScalarType<T[P], AggregatePayouts[P]>
  }




  export type payoutsGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: payoutsWhereInput
    orderBy?: payoutsOrderByWithAggregationInput | payoutsOrderByWithAggregationInput[]
    by: PayoutsScalarFieldEnum[] | PayoutsScalarFieldEnum
    having?: payoutsScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: PayoutsCountAggregateInputType | true
    _avg?: PayoutsAvgAggregateInputType
    _sum?: PayoutsSumAggregateInputType
    _min?: PayoutsMinAggregateInputType
    _max?: PayoutsMaxAggregateInputType
  }

  export type PayoutsGroupByOutputType = {
    id: string
    bid_id: string
    transfer_id: string
    dish_media_id: string
    amount_cents: bigint
    currency_code: string | null
    status: $Enums.payout_status
    created_at: Date
    updated_at: Date
    lock_no: number
    _count: PayoutsCountAggregateOutputType | null
    _avg: PayoutsAvgAggregateOutputType | null
    _sum: PayoutsSumAggregateOutputType | null
    _min: PayoutsMinAggregateOutputType | null
    _max: PayoutsMaxAggregateOutputType | null
  }

  type GetPayoutsGroupByPayload<T extends payoutsGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<PayoutsGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof PayoutsGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], PayoutsGroupByOutputType[P]>
            : GetScalarType<T[P], PayoutsGroupByOutputType[P]>
        }
      >
    >


  export type payoutsSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    bid_id?: boolean
    transfer_id?: boolean
    dish_media_id?: boolean
    amount_cents?: boolean
    currency_code?: boolean
    status?: boolean
    created_at?: boolean
    updated_at?: boolean
    lock_no?: boolean
    restaurant_bids?: boolean | restaurant_bidsDefaultArgs<ExtArgs>
    dish_media?: boolean | dish_mediaDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["payouts"]>

  export type payoutsSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    bid_id?: boolean
    transfer_id?: boolean
    dish_media_id?: boolean
    amount_cents?: boolean
    currency_code?: boolean
    status?: boolean
    created_at?: boolean
    updated_at?: boolean
    lock_no?: boolean
    restaurant_bids?: boolean | restaurant_bidsDefaultArgs<ExtArgs>
    dish_media?: boolean | dish_mediaDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["payouts"]>

  export type payoutsSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    bid_id?: boolean
    transfer_id?: boolean
    dish_media_id?: boolean
    amount_cents?: boolean
    currency_code?: boolean
    status?: boolean
    created_at?: boolean
    updated_at?: boolean
    lock_no?: boolean
    restaurant_bids?: boolean | restaurant_bidsDefaultArgs<ExtArgs>
    dish_media?: boolean | dish_mediaDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["payouts"]>

  export type payoutsSelectScalar = {
    id?: boolean
    bid_id?: boolean
    transfer_id?: boolean
    dish_media_id?: boolean
    amount_cents?: boolean
    currency_code?: boolean
    status?: boolean
    created_at?: boolean
    updated_at?: boolean
    lock_no?: boolean
  }

  export type payoutsOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "bid_id" | "transfer_id" | "dish_media_id" | "amount_cents" | "currency_code" | "status" | "created_at" | "updated_at" | "lock_no", ExtArgs["result"]["payouts"]>
  export type payoutsInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    restaurant_bids?: boolean | restaurant_bidsDefaultArgs<ExtArgs>
    dish_media?: boolean | dish_mediaDefaultArgs<ExtArgs>
  }
  export type payoutsIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    restaurant_bids?: boolean | restaurant_bidsDefaultArgs<ExtArgs>
    dish_media?: boolean | dish_mediaDefaultArgs<ExtArgs>
  }
  export type payoutsIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    restaurant_bids?: boolean | restaurant_bidsDefaultArgs<ExtArgs>
    dish_media?: boolean | dish_mediaDefaultArgs<ExtArgs>
  }

  export type $payoutsPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "payouts"
    objects: {
      restaurant_bids: Prisma.$restaurant_bidsPayload<ExtArgs>
      dish_media: Prisma.$dish_mediaPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      bid_id: string
      transfer_id: string
      dish_media_id: string
      amount_cents: bigint
      currency_code: string | null
      status: $Enums.payout_status
      created_at: Date
      updated_at: Date
      lock_no: number
    }, ExtArgs["result"]["payouts"]>
    composites: {}
  }

  type payoutsGetPayload<S extends boolean | null | undefined | payoutsDefaultArgs> = $Result.GetResult<Prisma.$payoutsPayload, S>

  type payoutsCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<payoutsFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: PayoutsCountAggregateInputType | true
    }

  export interface payoutsDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['payouts'], meta: { name: 'payouts' } }
    /**
     * Find zero or one Payouts that matches the filter.
     * @param {payoutsFindUniqueArgs} args - Arguments to find a Payouts
     * @example
     * // Get one Payouts
     * const payouts = await prisma.payouts.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends payoutsFindUniqueArgs>(args: SelectSubset<T, payoutsFindUniqueArgs<ExtArgs>>): Prisma__payoutsClient<$Result.GetResult<Prisma.$payoutsPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one Payouts that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {payoutsFindUniqueOrThrowArgs} args - Arguments to find a Payouts
     * @example
     * // Get one Payouts
     * const payouts = await prisma.payouts.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends payoutsFindUniqueOrThrowArgs>(args: SelectSubset<T, payoutsFindUniqueOrThrowArgs<ExtArgs>>): Prisma__payoutsClient<$Result.GetResult<Prisma.$payoutsPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Payouts that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {payoutsFindFirstArgs} args - Arguments to find a Payouts
     * @example
     * // Get one Payouts
     * const payouts = await prisma.payouts.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends payoutsFindFirstArgs>(args?: SelectSubset<T, payoutsFindFirstArgs<ExtArgs>>): Prisma__payoutsClient<$Result.GetResult<Prisma.$payoutsPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Payouts that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {payoutsFindFirstOrThrowArgs} args - Arguments to find a Payouts
     * @example
     * // Get one Payouts
     * const payouts = await prisma.payouts.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends payoutsFindFirstOrThrowArgs>(args?: SelectSubset<T, payoutsFindFirstOrThrowArgs<ExtArgs>>): Prisma__payoutsClient<$Result.GetResult<Prisma.$payoutsPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more Payouts that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {payoutsFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Payouts
     * const payouts = await prisma.payouts.findMany()
     * 
     * // Get first 10 Payouts
     * const payouts = await prisma.payouts.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const payoutsWithIdOnly = await prisma.payouts.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends payoutsFindManyArgs>(args?: SelectSubset<T, payoutsFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$payoutsPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a Payouts.
     * @param {payoutsCreateArgs} args - Arguments to create a Payouts.
     * @example
     * // Create one Payouts
     * const Payouts = await prisma.payouts.create({
     *   data: {
     *     // ... data to create a Payouts
     *   }
     * })
     * 
     */
    create<T extends payoutsCreateArgs>(args: SelectSubset<T, payoutsCreateArgs<ExtArgs>>): Prisma__payoutsClient<$Result.GetResult<Prisma.$payoutsPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many Payouts.
     * @param {payoutsCreateManyArgs} args - Arguments to create many Payouts.
     * @example
     * // Create many Payouts
     * const payouts = await prisma.payouts.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends payoutsCreateManyArgs>(args?: SelectSubset<T, payoutsCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Payouts and returns the data saved in the database.
     * @param {payoutsCreateManyAndReturnArgs} args - Arguments to create many Payouts.
     * @example
     * // Create many Payouts
     * const payouts = await prisma.payouts.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Payouts and only return the `id`
     * const payoutsWithIdOnly = await prisma.payouts.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends payoutsCreateManyAndReturnArgs>(args?: SelectSubset<T, payoutsCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$payoutsPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a Payouts.
     * @param {payoutsDeleteArgs} args - Arguments to delete one Payouts.
     * @example
     * // Delete one Payouts
     * const Payouts = await prisma.payouts.delete({
     *   where: {
     *     // ... filter to delete one Payouts
     *   }
     * })
     * 
     */
    delete<T extends payoutsDeleteArgs>(args: SelectSubset<T, payoutsDeleteArgs<ExtArgs>>): Prisma__payoutsClient<$Result.GetResult<Prisma.$payoutsPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one Payouts.
     * @param {payoutsUpdateArgs} args - Arguments to update one Payouts.
     * @example
     * // Update one Payouts
     * const payouts = await prisma.payouts.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends payoutsUpdateArgs>(args: SelectSubset<T, payoutsUpdateArgs<ExtArgs>>): Prisma__payoutsClient<$Result.GetResult<Prisma.$payoutsPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more Payouts.
     * @param {payoutsDeleteManyArgs} args - Arguments to filter Payouts to delete.
     * @example
     * // Delete a few Payouts
     * const { count } = await prisma.payouts.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends payoutsDeleteManyArgs>(args?: SelectSubset<T, payoutsDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Payouts.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {payoutsUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Payouts
     * const payouts = await prisma.payouts.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends payoutsUpdateManyArgs>(args: SelectSubset<T, payoutsUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Payouts and returns the data updated in the database.
     * @param {payoutsUpdateManyAndReturnArgs} args - Arguments to update many Payouts.
     * @example
     * // Update many Payouts
     * const payouts = await prisma.payouts.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more Payouts and only return the `id`
     * const payoutsWithIdOnly = await prisma.payouts.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends payoutsUpdateManyAndReturnArgs>(args: SelectSubset<T, payoutsUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$payoutsPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one Payouts.
     * @param {payoutsUpsertArgs} args - Arguments to update or create a Payouts.
     * @example
     * // Update or create a Payouts
     * const payouts = await prisma.payouts.upsert({
     *   create: {
     *     // ... data to create a Payouts
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Payouts we want to update
     *   }
     * })
     */
    upsert<T extends payoutsUpsertArgs>(args: SelectSubset<T, payoutsUpsertArgs<ExtArgs>>): Prisma__payoutsClient<$Result.GetResult<Prisma.$payoutsPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of Payouts.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {payoutsCountArgs} args - Arguments to filter Payouts to count.
     * @example
     * // Count the number of Payouts
     * const count = await prisma.payouts.count({
     *   where: {
     *     // ... the filter for the Payouts we want to count
     *   }
     * })
    **/
    count<T extends payoutsCountArgs>(
      args?: Subset<T, payoutsCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], PayoutsCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Payouts.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PayoutsAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends PayoutsAggregateArgs>(args: Subset<T, PayoutsAggregateArgs>): Prisma.PrismaPromise<GetPayoutsAggregateType<T>>

    /**
     * Group by Payouts.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {payoutsGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends payoutsGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: payoutsGroupByArgs['orderBy'] }
        : { orderBy?: payoutsGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, payoutsGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetPayoutsGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the payouts model
   */
  readonly fields: payoutsFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for payouts.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__payoutsClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    restaurant_bids<T extends restaurant_bidsDefaultArgs<ExtArgs> = {}>(args?: Subset<T, restaurant_bidsDefaultArgs<ExtArgs>>): Prisma__restaurant_bidsClient<$Result.GetResult<Prisma.$restaurant_bidsPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    dish_media<T extends dish_mediaDefaultArgs<ExtArgs> = {}>(args?: Subset<T, dish_mediaDefaultArgs<ExtArgs>>): Prisma__dish_mediaClient<$Result.GetResult<Prisma.$dish_mediaPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the payouts model
   */
  interface payoutsFieldRefs {
    readonly id: FieldRef<"payouts", 'String'>
    readonly bid_id: FieldRef<"payouts", 'String'>
    readonly transfer_id: FieldRef<"payouts", 'String'>
    readonly dish_media_id: FieldRef<"payouts", 'String'>
    readonly amount_cents: FieldRef<"payouts", 'BigInt'>
    readonly currency_code: FieldRef<"payouts", 'String'>
    readonly status: FieldRef<"payouts", 'payout_status'>
    readonly created_at: FieldRef<"payouts", 'DateTime'>
    readonly updated_at: FieldRef<"payouts", 'DateTime'>
    readonly lock_no: FieldRef<"payouts", 'Int'>
  }
    

  // Custom InputTypes
  /**
   * payouts findUnique
   */
  export type payoutsFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the payouts
     */
    select?: payoutsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the payouts
     */
    omit?: payoutsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: payoutsInclude<ExtArgs> | null
    /**
     * Filter, which payouts to fetch.
     */
    where: payoutsWhereUniqueInput
  }

  /**
   * payouts findUniqueOrThrow
   */
  export type payoutsFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the payouts
     */
    select?: payoutsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the payouts
     */
    omit?: payoutsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: payoutsInclude<ExtArgs> | null
    /**
     * Filter, which payouts to fetch.
     */
    where: payoutsWhereUniqueInput
  }

  /**
   * payouts findFirst
   */
  export type payoutsFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the payouts
     */
    select?: payoutsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the payouts
     */
    omit?: payoutsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: payoutsInclude<ExtArgs> | null
    /**
     * Filter, which payouts to fetch.
     */
    where?: payoutsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of payouts to fetch.
     */
    orderBy?: payoutsOrderByWithRelationInput | payoutsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for payouts.
     */
    cursor?: payoutsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` payouts from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` payouts.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of payouts.
     */
    distinct?: PayoutsScalarFieldEnum | PayoutsScalarFieldEnum[]
  }

  /**
   * payouts findFirstOrThrow
   */
  export type payoutsFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the payouts
     */
    select?: payoutsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the payouts
     */
    omit?: payoutsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: payoutsInclude<ExtArgs> | null
    /**
     * Filter, which payouts to fetch.
     */
    where?: payoutsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of payouts to fetch.
     */
    orderBy?: payoutsOrderByWithRelationInput | payoutsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for payouts.
     */
    cursor?: payoutsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` payouts from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` payouts.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of payouts.
     */
    distinct?: PayoutsScalarFieldEnum | PayoutsScalarFieldEnum[]
  }

  /**
   * payouts findMany
   */
  export type payoutsFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the payouts
     */
    select?: payoutsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the payouts
     */
    omit?: payoutsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: payoutsInclude<ExtArgs> | null
    /**
     * Filter, which payouts to fetch.
     */
    where?: payoutsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of payouts to fetch.
     */
    orderBy?: payoutsOrderByWithRelationInput | payoutsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing payouts.
     */
    cursor?: payoutsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` payouts from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` payouts.
     */
    skip?: number
    distinct?: PayoutsScalarFieldEnum | PayoutsScalarFieldEnum[]
  }

  /**
   * payouts create
   */
  export type payoutsCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the payouts
     */
    select?: payoutsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the payouts
     */
    omit?: payoutsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: payoutsInclude<ExtArgs> | null
    /**
     * The data needed to create a payouts.
     */
    data: XOR<payoutsCreateInput, payoutsUncheckedCreateInput>
  }

  /**
   * payouts createMany
   */
  export type payoutsCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many payouts.
     */
    data: payoutsCreateManyInput | payoutsCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * payouts createManyAndReturn
   */
  export type payoutsCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the payouts
     */
    select?: payoutsSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the payouts
     */
    omit?: payoutsOmit<ExtArgs> | null
    /**
     * The data used to create many payouts.
     */
    data: payoutsCreateManyInput | payoutsCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: payoutsIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * payouts update
   */
  export type payoutsUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the payouts
     */
    select?: payoutsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the payouts
     */
    omit?: payoutsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: payoutsInclude<ExtArgs> | null
    /**
     * The data needed to update a payouts.
     */
    data: XOR<payoutsUpdateInput, payoutsUncheckedUpdateInput>
    /**
     * Choose, which payouts to update.
     */
    where: payoutsWhereUniqueInput
  }

  /**
   * payouts updateMany
   */
  export type payoutsUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update payouts.
     */
    data: XOR<payoutsUpdateManyMutationInput, payoutsUncheckedUpdateManyInput>
    /**
     * Filter which payouts to update
     */
    where?: payoutsWhereInput
    /**
     * Limit how many payouts to update.
     */
    limit?: number
  }

  /**
   * payouts updateManyAndReturn
   */
  export type payoutsUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the payouts
     */
    select?: payoutsSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the payouts
     */
    omit?: payoutsOmit<ExtArgs> | null
    /**
     * The data used to update payouts.
     */
    data: XOR<payoutsUpdateManyMutationInput, payoutsUncheckedUpdateManyInput>
    /**
     * Filter which payouts to update
     */
    where?: payoutsWhereInput
    /**
     * Limit how many payouts to update.
     */
    limit?: number
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: payoutsIncludeUpdateManyAndReturn<ExtArgs> | null
  }

  /**
   * payouts upsert
   */
  export type payoutsUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the payouts
     */
    select?: payoutsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the payouts
     */
    omit?: payoutsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: payoutsInclude<ExtArgs> | null
    /**
     * The filter to search for the payouts to update in case it exists.
     */
    where: payoutsWhereUniqueInput
    /**
     * In case the payouts found by the `where` argument doesn't exist, create a new payouts with this data.
     */
    create: XOR<payoutsCreateInput, payoutsUncheckedCreateInput>
    /**
     * In case the payouts was found with the provided `where` argument, update it with this data.
     */
    update: XOR<payoutsUpdateInput, payoutsUncheckedUpdateInput>
  }

  /**
   * payouts delete
   */
  export type payoutsDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the payouts
     */
    select?: payoutsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the payouts
     */
    omit?: payoutsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: payoutsInclude<ExtArgs> | null
    /**
     * Filter which payouts to delete.
     */
    where: payoutsWhereUniqueInput
  }

  /**
   * payouts deleteMany
   */
  export type payoutsDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which payouts to delete
     */
    where?: payoutsWhereInput
    /**
     * Limit how many payouts to delete.
     */
    limit?: number
  }

  /**
   * payouts without action
   */
  export type payoutsDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the payouts
     */
    select?: payoutsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the payouts
     */
    omit?: payoutsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: payoutsInclude<ExtArgs> | null
  }


  /**
   * Model restaurant_bids
   */

  export type AggregateRestaurant_bids = {
    _count: Restaurant_bidsCountAggregateOutputType | null
    _avg: Restaurant_bidsAvgAggregateOutputType | null
    _sum: Restaurant_bidsSumAggregateOutputType | null
    _min: Restaurant_bidsMinAggregateOutputType | null
    _max: Restaurant_bidsMaxAggregateOutputType | null
  }

  export type Restaurant_bidsAvgAggregateOutputType = {
    amount_cents: number | null
    lock_no: number | null
  }

  export type Restaurant_bidsSumAggregateOutputType = {
    amount_cents: bigint | null
    lock_no: number | null
  }

  export type Restaurant_bidsMinAggregateOutputType = {
    id: string | null
    restaurant_id: string | null
    user_id: string | null
    payment_intent_id: string | null
    amount_cents: bigint | null
    currency_code: string | null
    start_date: Date | null
    end_date: Date | null
    status: $Enums.restaurant_bid_status | null
    refund_id: string | null
    created_at: Date | null
    updated_at: Date | null
    lock_no: number | null
  }

  export type Restaurant_bidsMaxAggregateOutputType = {
    id: string | null
    restaurant_id: string | null
    user_id: string | null
    payment_intent_id: string | null
    amount_cents: bigint | null
    currency_code: string | null
    start_date: Date | null
    end_date: Date | null
    status: $Enums.restaurant_bid_status | null
    refund_id: string | null
    created_at: Date | null
    updated_at: Date | null
    lock_no: number | null
  }

  export type Restaurant_bidsCountAggregateOutputType = {
    id: number
    restaurant_id: number
    user_id: number
    payment_intent_id: number
    amount_cents: number
    currency_code: number
    start_date: number
    end_date: number
    status: number
    refund_id: number
    created_at: number
    updated_at: number
    lock_no: number
    _all: number
  }


  export type Restaurant_bidsAvgAggregateInputType = {
    amount_cents?: true
    lock_no?: true
  }

  export type Restaurant_bidsSumAggregateInputType = {
    amount_cents?: true
    lock_no?: true
  }

  export type Restaurant_bidsMinAggregateInputType = {
    id?: true
    restaurant_id?: true
    user_id?: true
    payment_intent_id?: true
    amount_cents?: true
    currency_code?: true
    start_date?: true
    end_date?: true
    status?: true
    refund_id?: true
    created_at?: true
    updated_at?: true
    lock_no?: true
  }

  export type Restaurant_bidsMaxAggregateInputType = {
    id?: true
    restaurant_id?: true
    user_id?: true
    payment_intent_id?: true
    amount_cents?: true
    currency_code?: true
    start_date?: true
    end_date?: true
    status?: true
    refund_id?: true
    created_at?: true
    updated_at?: true
    lock_no?: true
  }

  export type Restaurant_bidsCountAggregateInputType = {
    id?: true
    restaurant_id?: true
    user_id?: true
    payment_intent_id?: true
    amount_cents?: true
    currency_code?: true
    start_date?: true
    end_date?: true
    status?: true
    refund_id?: true
    created_at?: true
    updated_at?: true
    lock_no?: true
    _all?: true
  }

  export type Restaurant_bidsAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which restaurant_bids to aggregate.
     */
    where?: restaurant_bidsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of restaurant_bids to fetch.
     */
    orderBy?: restaurant_bidsOrderByWithRelationInput | restaurant_bidsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: restaurant_bidsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` restaurant_bids from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` restaurant_bids.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned restaurant_bids
    **/
    _count?: true | Restaurant_bidsCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: Restaurant_bidsAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: Restaurant_bidsSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: Restaurant_bidsMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: Restaurant_bidsMaxAggregateInputType
  }

  export type GetRestaurant_bidsAggregateType<T extends Restaurant_bidsAggregateArgs> = {
        [P in keyof T & keyof AggregateRestaurant_bids]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateRestaurant_bids[P]>
      : GetScalarType<T[P], AggregateRestaurant_bids[P]>
  }




  export type restaurant_bidsGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: restaurant_bidsWhereInput
    orderBy?: restaurant_bidsOrderByWithAggregationInput | restaurant_bidsOrderByWithAggregationInput[]
    by: Restaurant_bidsScalarFieldEnum[] | Restaurant_bidsScalarFieldEnum
    having?: restaurant_bidsScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: Restaurant_bidsCountAggregateInputType | true
    _avg?: Restaurant_bidsAvgAggregateInputType
    _sum?: Restaurant_bidsSumAggregateInputType
    _min?: Restaurant_bidsMinAggregateInputType
    _max?: Restaurant_bidsMaxAggregateInputType
  }

  export type Restaurant_bidsGroupByOutputType = {
    id: string
    restaurant_id: string
    user_id: string
    payment_intent_id: string | null
    amount_cents: bigint
    currency_code: string
    start_date: Date
    end_date: Date
    status: $Enums.restaurant_bid_status
    refund_id: string | null
    created_at: Date
    updated_at: Date
    lock_no: number
    _count: Restaurant_bidsCountAggregateOutputType | null
    _avg: Restaurant_bidsAvgAggregateOutputType | null
    _sum: Restaurant_bidsSumAggregateOutputType | null
    _min: Restaurant_bidsMinAggregateOutputType | null
    _max: Restaurant_bidsMaxAggregateOutputType | null
  }

  type GetRestaurant_bidsGroupByPayload<T extends restaurant_bidsGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<Restaurant_bidsGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof Restaurant_bidsGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], Restaurant_bidsGroupByOutputType[P]>
            : GetScalarType<T[P], Restaurant_bidsGroupByOutputType[P]>
        }
      >
    >


  export type restaurant_bidsSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    restaurant_id?: boolean
    user_id?: boolean
    payment_intent_id?: boolean
    amount_cents?: boolean
    currency_code?: boolean
    start_date?: boolean
    end_date?: boolean
    status?: boolean
    refund_id?: boolean
    created_at?: boolean
    updated_at?: boolean
    lock_no?: boolean
    payouts?: boolean | restaurant_bids$payoutsArgs<ExtArgs>
    restaurants?: boolean | restaurantsDefaultArgs<ExtArgs>
    users?: boolean | usersDefaultArgs<ExtArgs>
    _count?: boolean | Restaurant_bidsCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["restaurant_bids"]>

  export type restaurant_bidsSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    restaurant_id?: boolean
    user_id?: boolean
    payment_intent_id?: boolean
    amount_cents?: boolean
    currency_code?: boolean
    start_date?: boolean
    end_date?: boolean
    status?: boolean
    refund_id?: boolean
    created_at?: boolean
    updated_at?: boolean
    lock_no?: boolean
    restaurants?: boolean | restaurantsDefaultArgs<ExtArgs>
    users?: boolean | usersDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["restaurant_bids"]>

  export type restaurant_bidsSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    restaurant_id?: boolean
    user_id?: boolean
    payment_intent_id?: boolean
    amount_cents?: boolean
    currency_code?: boolean
    start_date?: boolean
    end_date?: boolean
    status?: boolean
    refund_id?: boolean
    created_at?: boolean
    updated_at?: boolean
    lock_no?: boolean
    restaurants?: boolean | restaurantsDefaultArgs<ExtArgs>
    users?: boolean | usersDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["restaurant_bids"]>

  export type restaurant_bidsSelectScalar = {
    id?: boolean
    restaurant_id?: boolean
    user_id?: boolean
    payment_intent_id?: boolean
    amount_cents?: boolean
    currency_code?: boolean
    start_date?: boolean
    end_date?: boolean
    status?: boolean
    refund_id?: boolean
    created_at?: boolean
    updated_at?: boolean
    lock_no?: boolean
  }

  export type restaurant_bidsOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "restaurant_id" | "user_id" | "payment_intent_id" | "amount_cents" | "currency_code" | "start_date" | "end_date" | "status" | "refund_id" | "created_at" | "updated_at" | "lock_no", ExtArgs["result"]["restaurant_bids"]>
  export type restaurant_bidsInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    payouts?: boolean | restaurant_bids$payoutsArgs<ExtArgs>
    restaurants?: boolean | restaurantsDefaultArgs<ExtArgs>
    users?: boolean | usersDefaultArgs<ExtArgs>
    _count?: boolean | Restaurant_bidsCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type restaurant_bidsIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    restaurants?: boolean | restaurantsDefaultArgs<ExtArgs>
    users?: boolean | usersDefaultArgs<ExtArgs>
  }
  export type restaurant_bidsIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    restaurants?: boolean | restaurantsDefaultArgs<ExtArgs>
    users?: boolean | usersDefaultArgs<ExtArgs>
  }

  export type $restaurant_bidsPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "restaurant_bids"
    objects: {
      payouts: Prisma.$payoutsPayload<ExtArgs>[]
      restaurants: Prisma.$restaurantsPayload<ExtArgs>
      users: Prisma.$usersPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      restaurant_id: string
      user_id: string
      payment_intent_id: string | null
      amount_cents: bigint
      currency_code: string
      start_date: Date
      end_date: Date
      status: $Enums.restaurant_bid_status
      refund_id: string | null
      created_at: Date
      updated_at: Date
      lock_no: number
    }, ExtArgs["result"]["restaurant_bids"]>
    composites: {}
  }

  type restaurant_bidsGetPayload<S extends boolean | null | undefined | restaurant_bidsDefaultArgs> = $Result.GetResult<Prisma.$restaurant_bidsPayload, S>

  type restaurant_bidsCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<restaurant_bidsFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: Restaurant_bidsCountAggregateInputType | true
    }

  export interface restaurant_bidsDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['restaurant_bids'], meta: { name: 'restaurant_bids' } }
    /**
     * Find zero or one Restaurant_bids that matches the filter.
     * @param {restaurant_bidsFindUniqueArgs} args - Arguments to find a Restaurant_bids
     * @example
     * // Get one Restaurant_bids
     * const restaurant_bids = await prisma.restaurant_bids.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends restaurant_bidsFindUniqueArgs>(args: SelectSubset<T, restaurant_bidsFindUniqueArgs<ExtArgs>>): Prisma__restaurant_bidsClient<$Result.GetResult<Prisma.$restaurant_bidsPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one Restaurant_bids that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {restaurant_bidsFindUniqueOrThrowArgs} args - Arguments to find a Restaurant_bids
     * @example
     * // Get one Restaurant_bids
     * const restaurant_bids = await prisma.restaurant_bids.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends restaurant_bidsFindUniqueOrThrowArgs>(args: SelectSubset<T, restaurant_bidsFindUniqueOrThrowArgs<ExtArgs>>): Prisma__restaurant_bidsClient<$Result.GetResult<Prisma.$restaurant_bidsPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Restaurant_bids that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {restaurant_bidsFindFirstArgs} args - Arguments to find a Restaurant_bids
     * @example
     * // Get one Restaurant_bids
     * const restaurant_bids = await prisma.restaurant_bids.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends restaurant_bidsFindFirstArgs>(args?: SelectSubset<T, restaurant_bidsFindFirstArgs<ExtArgs>>): Prisma__restaurant_bidsClient<$Result.GetResult<Prisma.$restaurant_bidsPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Restaurant_bids that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {restaurant_bidsFindFirstOrThrowArgs} args - Arguments to find a Restaurant_bids
     * @example
     * // Get one Restaurant_bids
     * const restaurant_bids = await prisma.restaurant_bids.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends restaurant_bidsFindFirstOrThrowArgs>(args?: SelectSubset<T, restaurant_bidsFindFirstOrThrowArgs<ExtArgs>>): Prisma__restaurant_bidsClient<$Result.GetResult<Prisma.$restaurant_bidsPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more Restaurant_bids that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {restaurant_bidsFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Restaurant_bids
     * const restaurant_bids = await prisma.restaurant_bids.findMany()
     * 
     * // Get first 10 Restaurant_bids
     * const restaurant_bids = await prisma.restaurant_bids.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const restaurant_bidsWithIdOnly = await prisma.restaurant_bids.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends restaurant_bidsFindManyArgs>(args?: SelectSubset<T, restaurant_bidsFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$restaurant_bidsPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a Restaurant_bids.
     * @param {restaurant_bidsCreateArgs} args - Arguments to create a Restaurant_bids.
     * @example
     * // Create one Restaurant_bids
     * const Restaurant_bids = await prisma.restaurant_bids.create({
     *   data: {
     *     // ... data to create a Restaurant_bids
     *   }
     * })
     * 
     */
    create<T extends restaurant_bidsCreateArgs>(args: SelectSubset<T, restaurant_bidsCreateArgs<ExtArgs>>): Prisma__restaurant_bidsClient<$Result.GetResult<Prisma.$restaurant_bidsPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many Restaurant_bids.
     * @param {restaurant_bidsCreateManyArgs} args - Arguments to create many Restaurant_bids.
     * @example
     * // Create many Restaurant_bids
     * const restaurant_bids = await prisma.restaurant_bids.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends restaurant_bidsCreateManyArgs>(args?: SelectSubset<T, restaurant_bidsCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Restaurant_bids and returns the data saved in the database.
     * @param {restaurant_bidsCreateManyAndReturnArgs} args - Arguments to create many Restaurant_bids.
     * @example
     * // Create many Restaurant_bids
     * const restaurant_bids = await prisma.restaurant_bids.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Restaurant_bids and only return the `id`
     * const restaurant_bidsWithIdOnly = await prisma.restaurant_bids.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends restaurant_bidsCreateManyAndReturnArgs>(args?: SelectSubset<T, restaurant_bidsCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$restaurant_bidsPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a Restaurant_bids.
     * @param {restaurant_bidsDeleteArgs} args - Arguments to delete one Restaurant_bids.
     * @example
     * // Delete one Restaurant_bids
     * const Restaurant_bids = await prisma.restaurant_bids.delete({
     *   where: {
     *     // ... filter to delete one Restaurant_bids
     *   }
     * })
     * 
     */
    delete<T extends restaurant_bidsDeleteArgs>(args: SelectSubset<T, restaurant_bidsDeleteArgs<ExtArgs>>): Prisma__restaurant_bidsClient<$Result.GetResult<Prisma.$restaurant_bidsPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one Restaurant_bids.
     * @param {restaurant_bidsUpdateArgs} args - Arguments to update one Restaurant_bids.
     * @example
     * // Update one Restaurant_bids
     * const restaurant_bids = await prisma.restaurant_bids.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends restaurant_bidsUpdateArgs>(args: SelectSubset<T, restaurant_bidsUpdateArgs<ExtArgs>>): Prisma__restaurant_bidsClient<$Result.GetResult<Prisma.$restaurant_bidsPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more Restaurant_bids.
     * @param {restaurant_bidsDeleteManyArgs} args - Arguments to filter Restaurant_bids to delete.
     * @example
     * // Delete a few Restaurant_bids
     * const { count } = await prisma.restaurant_bids.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends restaurant_bidsDeleteManyArgs>(args?: SelectSubset<T, restaurant_bidsDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Restaurant_bids.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {restaurant_bidsUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Restaurant_bids
     * const restaurant_bids = await prisma.restaurant_bids.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends restaurant_bidsUpdateManyArgs>(args: SelectSubset<T, restaurant_bidsUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Restaurant_bids and returns the data updated in the database.
     * @param {restaurant_bidsUpdateManyAndReturnArgs} args - Arguments to update many Restaurant_bids.
     * @example
     * // Update many Restaurant_bids
     * const restaurant_bids = await prisma.restaurant_bids.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more Restaurant_bids and only return the `id`
     * const restaurant_bidsWithIdOnly = await prisma.restaurant_bids.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends restaurant_bidsUpdateManyAndReturnArgs>(args: SelectSubset<T, restaurant_bidsUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$restaurant_bidsPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one Restaurant_bids.
     * @param {restaurant_bidsUpsertArgs} args - Arguments to update or create a Restaurant_bids.
     * @example
     * // Update or create a Restaurant_bids
     * const restaurant_bids = await prisma.restaurant_bids.upsert({
     *   create: {
     *     // ... data to create a Restaurant_bids
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Restaurant_bids we want to update
     *   }
     * })
     */
    upsert<T extends restaurant_bidsUpsertArgs>(args: SelectSubset<T, restaurant_bidsUpsertArgs<ExtArgs>>): Prisma__restaurant_bidsClient<$Result.GetResult<Prisma.$restaurant_bidsPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of Restaurant_bids.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {restaurant_bidsCountArgs} args - Arguments to filter Restaurant_bids to count.
     * @example
     * // Count the number of Restaurant_bids
     * const count = await prisma.restaurant_bids.count({
     *   where: {
     *     // ... the filter for the Restaurant_bids we want to count
     *   }
     * })
    **/
    count<T extends restaurant_bidsCountArgs>(
      args?: Subset<T, restaurant_bidsCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], Restaurant_bidsCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Restaurant_bids.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Restaurant_bidsAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends Restaurant_bidsAggregateArgs>(args: Subset<T, Restaurant_bidsAggregateArgs>): Prisma.PrismaPromise<GetRestaurant_bidsAggregateType<T>>

    /**
     * Group by Restaurant_bids.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {restaurant_bidsGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends restaurant_bidsGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: restaurant_bidsGroupByArgs['orderBy'] }
        : { orderBy?: restaurant_bidsGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, restaurant_bidsGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetRestaurant_bidsGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the restaurant_bids model
   */
  readonly fields: restaurant_bidsFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for restaurant_bids.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__restaurant_bidsClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    payouts<T extends restaurant_bids$payoutsArgs<ExtArgs> = {}>(args?: Subset<T, restaurant_bids$payoutsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$payoutsPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    restaurants<T extends restaurantsDefaultArgs<ExtArgs> = {}>(args?: Subset<T, restaurantsDefaultArgs<ExtArgs>>): Prisma__restaurantsClient<$Result.GetResult<Prisma.$restaurantsPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    users<T extends usersDefaultArgs<ExtArgs> = {}>(args?: Subset<T, usersDefaultArgs<ExtArgs>>): Prisma__usersClient<$Result.GetResult<Prisma.$usersPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the restaurant_bids model
   */
  interface restaurant_bidsFieldRefs {
    readonly id: FieldRef<"restaurant_bids", 'String'>
    readonly restaurant_id: FieldRef<"restaurant_bids", 'String'>
    readonly user_id: FieldRef<"restaurant_bids", 'String'>
    readonly payment_intent_id: FieldRef<"restaurant_bids", 'String'>
    readonly amount_cents: FieldRef<"restaurant_bids", 'BigInt'>
    readonly currency_code: FieldRef<"restaurant_bids", 'String'>
    readonly start_date: FieldRef<"restaurant_bids", 'DateTime'>
    readonly end_date: FieldRef<"restaurant_bids", 'DateTime'>
    readonly status: FieldRef<"restaurant_bids", 'restaurant_bid_status'>
    readonly refund_id: FieldRef<"restaurant_bids", 'String'>
    readonly created_at: FieldRef<"restaurant_bids", 'DateTime'>
    readonly updated_at: FieldRef<"restaurant_bids", 'DateTime'>
    readonly lock_no: FieldRef<"restaurant_bids", 'Int'>
  }
    

  // Custom InputTypes
  /**
   * restaurant_bids findUnique
   */
  export type restaurant_bidsFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the restaurant_bids
     */
    select?: restaurant_bidsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the restaurant_bids
     */
    omit?: restaurant_bidsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: restaurant_bidsInclude<ExtArgs> | null
    /**
     * Filter, which restaurant_bids to fetch.
     */
    where: restaurant_bidsWhereUniqueInput
  }

  /**
   * restaurant_bids findUniqueOrThrow
   */
  export type restaurant_bidsFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the restaurant_bids
     */
    select?: restaurant_bidsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the restaurant_bids
     */
    omit?: restaurant_bidsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: restaurant_bidsInclude<ExtArgs> | null
    /**
     * Filter, which restaurant_bids to fetch.
     */
    where: restaurant_bidsWhereUniqueInput
  }

  /**
   * restaurant_bids findFirst
   */
  export type restaurant_bidsFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the restaurant_bids
     */
    select?: restaurant_bidsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the restaurant_bids
     */
    omit?: restaurant_bidsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: restaurant_bidsInclude<ExtArgs> | null
    /**
     * Filter, which restaurant_bids to fetch.
     */
    where?: restaurant_bidsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of restaurant_bids to fetch.
     */
    orderBy?: restaurant_bidsOrderByWithRelationInput | restaurant_bidsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for restaurant_bids.
     */
    cursor?: restaurant_bidsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` restaurant_bids from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` restaurant_bids.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of restaurant_bids.
     */
    distinct?: Restaurant_bidsScalarFieldEnum | Restaurant_bidsScalarFieldEnum[]
  }

  /**
   * restaurant_bids findFirstOrThrow
   */
  export type restaurant_bidsFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the restaurant_bids
     */
    select?: restaurant_bidsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the restaurant_bids
     */
    omit?: restaurant_bidsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: restaurant_bidsInclude<ExtArgs> | null
    /**
     * Filter, which restaurant_bids to fetch.
     */
    where?: restaurant_bidsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of restaurant_bids to fetch.
     */
    orderBy?: restaurant_bidsOrderByWithRelationInput | restaurant_bidsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for restaurant_bids.
     */
    cursor?: restaurant_bidsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` restaurant_bids from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` restaurant_bids.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of restaurant_bids.
     */
    distinct?: Restaurant_bidsScalarFieldEnum | Restaurant_bidsScalarFieldEnum[]
  }

  /**
   * restaurant_bids findMany
   */
  export type restaurant_bidsFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the restaurant_bids
     */
    select?: restaurant_bidsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the restaurant_bids
     */
    omit?: restaurant_bidsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: restaurant_bidsInclude<ExtArgs> | null
    /**
     * Filter, which restaurant_bids to fetch.
     */
    where?: restaurant_bidsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of restaurant_bids to fetch.
     */
    orderBy?: restaurant_bidsOrderByWithRelationInput | restaurant_bidsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing restaurant_bids.
     */
    cursor?: restaurant_bidsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` restaurant_bids from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` restaurant_bids.
     */
    skip?: number
    distinct?: Restaurant_bidsScalarFieldEnum | Restaurant_bidsScalarFieldEnum[]
  }

  /**
   * restaurant_bids create
   */
  export type restaurant_bidsCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the restaurant_bids
     */
    select?: restaurant_bidsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the restaurant_bids
     */
    omit?: restaurant_bidsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: restaurant_bidsInclude<ExtArgs> | null
    /**
     * The data needed to create a restaurant_bids.
     */
    data: XOR<restaurant_bidsCreateInput, restaurant_bidsUncheckedCreateInput>
  }

  /**
   * restaurant_bids createMany
   */
  export type restaurant_bidsCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many restaurant_bids.
     */
    data: restaurant_bidsCreateManyInput | restaurant_bidsCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * restaurant_bids createManyAndReturn
   */
  export type restaurant_bidsCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the restaurant_bids
     */
    select?: restaurant_bidsSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the restaurant_bids
     */
    omit?: restaurant_bidsOmit<ExtArgs> | null
    /**
     * The data used to create many restaurant_bids.
     */
    data: restaurant_bidsCreateManyInput | restaurant_bidsCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: restaurant_bidsIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * restaurant_bids update
   */
  export type restaurant_bidsUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the restaurant_bids
     */
    select?: restaurant_bidsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the restaurant_bids
     */
    omit?: restaurant_bidsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: restaurant_bidsInclude<ExtArgs> | null
    /**
     * The data needed to update a restaurant_bids.
     */
    data: XOR<restaurant_bidsUpdateInput, restaurant_bidsUncheckedUpdateInput>
    /**
     * Choose, which restaurant_bids to update.
     */
    where: restaurant_bidsWhereUniqueInput
  }

  /**
   * restaurant_bids updateMany
   */
  export type restaurant_bidsUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update restaurant_bids.
     */
    data: XOR<restaurant_bidsUpdateManyMutationInput, restaurant_bidsUncheckedUpdateManyInput>
    /**
     * Filter which restaurant_bids to update
     */
    where?: restaurant_bidsWhereInput
    /**
     * Limit how many restaurant_bids to update.
     */
    limit?: number
  }

  /**
   * restaurant_bids updateManyAndReturn
   */
  export type restaurant_bidsUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the restaurant_bids
     */
    select?: restaurant_bidsSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the restaurant_bids
     */
    omit?: restaurant_bidsOmit<ExtArgs> | null
    /**
     * The data used to update restaurant_bids.
     */
    data: XOR<restaurant_bidsUpdateManyMutationInput, restaurant_bidsUncheckedUpdateManyInput>
    /**
     * Filter which restaurant_bids to update
     */
    where?: restaurant_bidsWhereInput
    /**
     * Limit how many restaurant_bids to update.
     */
    limit?: number
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: restaurant_bidsIncludeUpdateManyAndReturn<ExtArgs> | null
  }

  /**
   * restaurant_bids upsert
   */
  export type restaurant_bidsUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the restaurant_bids
     */
    select?: restaurant_bidsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the restaurant_bids
     */
    omit?: restaurant_bidsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: restaurant_bidsInclude<ExtArgs> | null
    /**
     * The filter to search for the restaurant_bids to update in case it exists.
     */
    where: restaurant_bidsWhereUniqueInput
    /**
     * In case the restaurant_bids found by the `where` argument doesn't exist, create a new restaurant_bids with this data.
     */
    create: XOR<restaurant_bidsCreateInput, restaurant_bidsUncheckedCreateInput>
    /**
     * In case the restaurant_bids was found with the provided `where` argument, update it with this data.
     */
    update: XOR<restaurant_bidsUpdateInput, restaurant_bidsUncheckedUpdateInput>
  }

  /**
   * restaurant_bids delete
   */
  export type restaurant_bidsDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the restaurant_bids
     */
    select?: restaurant_bidsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the restaurant_bids
     */
    omit?: restaurant_bidsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: restaurant_bidsInclude<ExtArgs> | null
    /**
     * Filter which restaurant_bids to delete.
     */
    where: restaurant_bidsWhereUniqueInput
  }

  /**
   * restaurant_bids deleteMany
   */
  export type restaurant_bidsDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which restaurant_bids to delete
     */
    where?: restaurant_bidsWhereInput
    /**
     * Limit how many restaurant_bids to delete.
     */
    limit?: number
  }

  /**
   * restaurant_bids.payouts
   */
  export type restaurant_bids$payoutsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the payouts
     */
    select?: payoutsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the payouts
     */
    omit?: payoutsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: payoutsInclude<ExtArgs> | null
    where?: payoutsWhereInput
    orderBy?: payoutsOrderByWithRelationInput | payoutsOrderByWithRelationInput[]
    cursor?: payoutsWhereUniqueInput
    take?: number
    skip?: number
    distinct?: PayoutsScalarFieldEnum | PayoutsScalarFieldEnum[]
  }

  /**
   * restaurant_bids without action
   */
  export type restaurant_bidsDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the restaurant_bids
     */
    select?: restaurant_bidsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the restaurant_bids
     */
    omit?: restaurant_bidsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: restaurant_bidsInclude<ExtArgs> | null
  }


  /**
   * Model restaurants
   */

  export type AggregateRestaurants = {
    _count: RestaurantsCountAggregateOutputType | null
    _min: RestaurantsMinAggregateOutputType | null
    _max: RestaurantsMaxAggregateOutputType | null
  }

  export type RestaurantsMinAggregateOutputType = {
    id: string | null
    google_place_id: string | null
    name: string | null
    image_url: string | null
    created_at: Date | null
  }

  export type RestaurantsMaxAggregateOutputType = {
    id: string | null
    google_place_id: string | null
    name: string | null
    image_url: string | null
    created_at: Date | null
  }

  export type RestaurantsCountAggregateOutputType = {
    id: number
    google_place_id: number
    name: number
    image_url: number
    created_at: number
    _all: number
  }


  export type RestaurantsMinAggregateInputType = {
    id?: true
    google_place_id?: true
    name?: true
    image_url?: true
    created_at?: true
  }

  export type RestaurantsMaxAggregateInputType = {
    id?: true
    google_place_id?: true
    name?: true
    image_url?: true
    created_at?: true
  }

  export type RestaurantsCountAggregateInputType = {
    id?: true
    google_place_id?: true
    name?: true
    image_url?: true
    created_at?: true
    _all?: true
  }

  export type RestaurantsAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which restaurants to aggregate.
     */
    where?: restaurantsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of restaurants to fetch.
     */
    orderBy?: restaurantsOrderByWithRelationInput | restaurantsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: restaurantsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` restaurants from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` restaurants.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned restaurants
    **/
    _count?: true | RestaurantsCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: RestaurantsMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: RestaurantsMaxAggregateInputType
  }

  export type GetRestaurantsAggregateType<T extends RestaurantsAggregateArgs> = {
        [P in keyof T & keyof AggregateRestaurants]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateRestaurants[P]>
      : GetScalarType<T[P], AggregateRestaurants[P]>
  }




  export type restaurantsGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: restaurantsWhereInput
    orderBy?: restaurantsOrderByWithAggregationInput | restaurantsOrderByWithAggregationInput[]
    by: RestaurantsScalarFieldEnum[] | RestaurantsScalarFieldEnum
    having?: restaurantsScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: RestaurantsCountAggregateInputType | true
    _min?: RestaurantsMinAggregateInputType
    _max?: RestaurantsMaxAggregateInputType
  }

  export type RestaurantsGroupByOutputType = {
    id: string
    google_place_id: string | null
    name: string
    image_url: string | null
    created_at: Date
    _count: RestaurantsCountAggregateOutputType | null
    _min: RestaurantsMinAggregateOutputType | null
    _max: RestaurantsMaxAggregateOutputType | null
  }

  type GetRestaurantsGroupByPayload<T extends restaurantsGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<RestaurantsGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof RestaurantsGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], RestaurantsGroupByOutputType[P]>
            : GetScalarType<T[P], RestaurantsGroupByOutputType[P]>
        }
      >
    >


  export type restaurantsSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    google_place_id?: boolean
    name?: boolean
    image_url?: boolean
    created_at?: boolean
    dishes?: boolean | restaurants$dishesArgs<ExtArgs>
    restaurant_bids?: boolean | restaurants$restaurant_bidsArgs<ExtArgs>
    _count?: boolean | RestaurantsCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["restaurants"]>


  export type restaurantsSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    google_place_id?: boolean
    name?: boolean
    image_url?: boolean
    created_at?: boolean
  }, ExtArgs["result"]["restaurants"]>

  export type restaurantsSelectScalar = {
    id?: boolean
    google_place_id?: boolean
    name?: boolean
    image_url?: boolean
    created_at?: boolean
  }

  export type restaurantsOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "google_place_id" | "name" | "image_url" | "created_at", ExtArgs["result"]["restaurants"]>
  export type restaurantsInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    dishes?: boolean | restaurants$dishesArgs<ExtArgs>
    restaurant_bids?: boolean | restaurants$restaurant_bidsArgs<ExtArgs>
    _count?: boolean | RestaurantsCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type restaurantsIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}

  export type $restaurantsPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "restaurants"
    objects: {
      dishes: Prisma.$dishesPayload<ExtArgs>[]
      restaurant_bids: Prisma.$restaurant_bidsPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      google_place_id: string | null
      name: string
      image_url: string | null
      created_at: Date
    }, ExtArgs["result"]["restaurants"]>
    composites: {}
  }

  type restaurantsGetPayload<S extends boolean | null | undefined | restaurantsDefaultArgs> = $Result.GetResult<Prisma.$restaurantsPayload, S>

  type restaurantsCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<restaurantsFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: RestaurantsCountAggregateInputType | true
    }

  export interface restaurantsDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['restaurants'], meta: { name: 'restaurants' } }
    /**
     * Find zero or one Restaurants that matches the filter.
     * @param {restaurantsFindUniqueArgs} args - Arguments to find a Restaurants
     * @example
     * // Get one Restaurants
     * const restaurants = await prisma.restaurants.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends restaurantsFindUniqueArgs>(args: SelectSubset<T, restaurantsFindUniqueArgs<ExtArgs>>): Prisma__restaurantsClient<$Result.GetResult<Prisma.$restaurantsPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one Restaurants that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {restaurantsFindUniqueOrThrowArgs} args - Arguments to find a Restaurants
     * @example
     * // Get one Restaurants
     * const restaurants = await prisma.restaurants.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends restaurantsFindUniqueOrThrowArgs>(args: SelectSubset<T, restaurantsFindUniqueOrThrowArgs<ExtArgs>>): Prisma__restaurantsClient<$Result.GetResult<Prisma.$restaurantsPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Restaurants that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {restaurantsFindFirstArgs} args - Arguments to find a Restaurants
     * @example
     * // Get one Restaurants
     * const restaurants = await prisma.restaurants.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends restaurantsFindFirstArgs>(args?: SelectSubset<T, restaurantsFindFirstArgs<ExtArgs>>): Prisma__restaurantsClient<$Result.GetResult<Prisma.$restaurantsPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Restaurants that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {restaurantsFindFirstOrThrowArgs} args - Arguments to find a Restaurants
     * @example
     * // Get one Restaurants
     * const restaurants = await prisma.restaurants.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends restaurantsFindFirstOrThrowArgs>(args?: SelectSubset<T, restaurantsFindFirstOrThrowArgs<ExtArgs>>): Prisma__restaurantsClient<$Result.GetResult<Prisma.$restaurantsPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more Restaurants that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {restaurantsFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Restaurants
     * const restaurants = await prisma.restaurants.findMany()
     * 
     * // Get first 10 Restaurants
     * const restaurants = await prisma.restaurants.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const restaurantsWithIdOnly = await prisma.restaurants.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends restaurantsFindManyArgs>(args?: SelectSubset<T, restaurantsFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$restaurantsPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Delete a Restaurants.
     * @param {restaurantsDeleteArgs} args - Arguments to delete one Restaurants.
     * @example
     * // Delete one Restaurants
     * const Restaurants = await prisma.restaurants.delete({
     *   where: {
     *     // ... filter to delete one Restaurants
     *   }
     * })
     * 
     */
    delete<T extends restaurantsDeleteArgs>(args: SelectSubset<T, restaurantsDeleteArgs<ExtArgs>>): Prisma__restaurantsClient<$Result.GetResult<Prisma.$restaurantsPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one Restaurants.
     * @param {restaurantsUpdateArgs} args - Arguments to update one Restaurants.
     * @example
     * // Update one Restaurants
     * const restaurants = await prisma.restaurants.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends restaurantsUpdateArgs>(args: SelectSubset<T, restaurantsUpdateArgs<ExtArgs>>): Prisma__restaurantsClient<$Result.GetResult<Prisma.$restaurantsPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more Restaurants.
     * @param {restaurantsDeleteManyArgs} args - Arguments to filter Restaurants to delete.
     * @example
     * // Delete a few Restaurants
     * const { count } = await prisma.restaurants.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends restaurantsDeleteManyArgs>(args?: SelectSubset<T, restaurantsDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Restaurants.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {restaurantsUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Restaurants
     * const restaurants = await prisma.restaurants.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends restaurantsUpdateManyArgs>(args: SelectSubset<T, restaurantsUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Restaurants and returns the data updated in the database.
     * @param {restaurantsUpdateManyAndReturnArgs} args - Arguments to update many Restaurants.
     * @example
     * // Update many Restaurants
     * const restaurants = await prisma.restaurants.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more Restaurants and only return the `id`
     * const restaurantsWithIdOnly = await prisma.restaurants.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends restaurantsUpdateManyAndReturnArgs>(args: SelectSubset<T, restaurantsUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$restaurantsPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>


    /**
     * Count the number of Restaurants.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {restaurantsCountArgs} args - Arguments to filter Restaurants to count.
     * @example
     * // Count the number of Restaurants
     * const count = await prisma.restaurants.count({
     *   where: {
     *     // ... the filter for the Restaurants we want to count
     *   }
     * })
    **/
    count<T extends restaurantsCountArgs>(
      args?: Subset<T, restaurantsCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], RestaurantsCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Restaurants.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RestaurantsAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends RestaurantsAggregateArgs>(args: Subset<T, RestaurantsAggregateArgs>): Prisma.PrismaPromise<GetRestaurantsAggregateType<T>>

    /**
     * Group by Restaurants.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {restaurantsGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends restaurantsGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: restaurantsGroupByArgs['orderBy'] }
        : { orderBy?: restaurantsGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, restaurantsGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetRestaurantsGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the restaurants model
   */
  readonly fields: restaurantsFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for restaurants.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__restaurantsClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    dishes<T extends restaurants$dishesArgs<ExtArgs> = {}>(args?: Subset<T, restaurants$dishesArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$dishesPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    restaurant_bids<T extends restaurants$restaurant_bidsArgs<ExtArgs> = {}>(args?: Subset<T, restaurants$restaurant_bidsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$restaurant_bidsPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the restaurants model
   */
  interface restaurantsFieldRefs {
    readonly id: FieldRef<"restaurants", 'String'>
    readonly google_place_id: FieldRef<"restaurants", 'String'>
    readonly name: FieldRef<"restaurants", 'String'>
    readonly image_url: FieldRef<"restaurants", 'String'>
    readonly created_at: FieldRef<"restaurants", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * restaurants findUnique
   */
  export type restaurantsFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the restaurants
     */
    select?: restaurantsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the restaurants
     */
    omit?: restaurantsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: restaurantsInclude<ExtArgs> | null
    /**
     * Filter, which restaurants to fetch.
     */
    where: restaurantsWhereUniqueInput
  }

  /**
   * restaurants findUniqueOrThrow
   */
  export type restaurantsFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the restaurants
     */
    select?: restaurantsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the restaurants
     */
    omit?: restaurantsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: restaurantsInclude<ExtArgs> | null
    /**
     * Filter, which restaurants to fetch.
     */
    where: restaurantsWhereUniqueInput
  }

  /**
   * restaurants findFirst
   */
  export type restaurantsFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the restaurants
     */
    select?: restaurantsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the restaurants
     */
    omit?: restaurantsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: restaurantsInclude<ExtArgs> | null
    /**
     * Filter, which restaurants to fetch.
     */
    where?: restaurantsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of restaurants to fetch.
     */
    orderBy?: restaurantsOrderByWithRelationInput | restaurantsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for restaurants.
     */
    cursor?: restaurantsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` restaurants from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` restaurants.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of restaurants.
     */
    distinct?: RestaurantsScalarFieldEnum | RestaurantsScalarFieldEnum[]
  }

  /**
   * restaurants findFirstOrThrow
   */
  export type restaurantsFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the restaurants
     */
    select?: restaurantsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the restaurants
     */
    omit?: restaurantsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: restaurantsInclude<ExtArgs> | null
    /**
     * Filter, which restaurants to fetch.
     */
    where?: restaurantsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of restaurants to fetch.
     */
    orderBy?: restaurantsOrderByWithRelationInput | restaurantsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for restaurants.
     */
    cursor?: restaurantsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` restaurants from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` restaurants.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of restaurants.
     */
    distinct?: RestaurantsScalarFieldEnum | RestaurantsScalarFieldEnum[]
  }

  /**
   * restaurants findMany
   */
  export type restaurantsFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the restaurants
     */
    select?: restaurantsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the restaurants
     */
    omit?: restaurantsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: restaurantsInclude<ExtArgs> | null
    /**
     * Filter, which restaurants to fetch.
     */
    where?: restaurantsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of restaurants to fetch.
     */
    orderBy?: restaurantsOrderByWithRelationInput | restaurantsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing restaurants.
     */
    cursor?: restaurantsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` restaurants from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` restaurants.
     */
    skip?: number
    distinct?: RestaurantsScalarFieldEnum | RestaurantsScalarFieldEnum[]
  }

  /**
   * restaurants update
   */
  export type restaurantsUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the restaurants
     */
    select?: restaurantsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the restaurants
     */
    omit?: restaurantsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: restaurantsInclude<ExtArgs> | null
    /**
     * The data needed to update a restaurants.
     */
    data: XOR<restaurantsUpdateInput, restaurantsUncheckedUpdateInput>
    /**
     * Choose, which restaurants to update.
     */
    where: restaurantsWhereUniqueInput
  }

  /**
   * restaurants updateMany
   */
  export type restaurantsUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update restaurants.
     */
    data: XOR<restaurantsUpdateManyMutationInput, restaurantsUncheckedUpdateManyInput>
    /**
     * Filter which restaurants to update
     */
    where?: restaurantsWhereInput
    /**
     * Limit how many restaurants to update.
     */
    limit?: number
  }

  /**
   * restaurants updateManyAndReturn
   */
  export type restaurantsUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the restaurants
     */
    select?: restaurantsSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the restaurants
     */
    omit?: restaurantsOmit<ExtArgs> | null
    /**
     * The data used to update restaurants.
     */
    data: XOR<restaurantsUpdateManyMutationInput, restaurantsUncheckedUpdateManyInput>
    /**
     * Filter which restaurants to update
     */
    where?: restaurantsWhereInput
    /**
     * Limit how many restaurants to update.
     */
    limit?: number
  }

  /**
   * restaurants delete
   */
  export type restaurantsDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the restaurants
     */
    select?: restaurantsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the restaurants
     */
    omit?: restaurantsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: restaurantsInclude<ExtArgs> | null
    /**
     * Filter which restaurants to delete.
     */
    where: restaurantsWhereUniqueInput
  }

  /**
   * restaurants deleteMany
   */
  export type restaurantsDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which restaurants to delete
     */
    where?: restaurantsWhereInput
    /**
     * Limit how many restaurants to delete.
     */
    limit?: number
  }

  /**
   * restaurants.dishes
   */
  export type restaurants$dishesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dishes
     */
    select?: dishesSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dishes
     */
    omit?: dishesOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dishesInclude<ExtArgs> | null
    where?: dishesWhereInput
    orderBy?: dishesOrderByWithRelationInput | dishesOrderByWithRelationInput[]
    cursor?: dishesWhereUniqueInput
    take?: number
    skip?: number
    distinct?: DishesScalarFieldEnum | DishesScalarFieldEnum[]
  }

  /**
   * restaurants.restaurant_bids
   */
  export type restaurants$restaurant_bidsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the restaurant_bids
     */
    select?: restaurant_bidsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the restaurant_bids
     */
    omit?: restaurant_bidsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: restaurant_bidsInclude<ExtArgs> | null
    where?: restaurant_bidsWhereInput
    orderBy?: restaurant_bidsOrderByWithRelationInput | restaurant_bidsOrderByWithRelationInput[]
    cursor?: restaurant_bidsWhereUniqueInput
    take?: number
    skip?: number
    distinct?: Restaurant_bidsScalarFieldEnum | Restaurant_bidsScalarFieldEnum[]
  }

  /**
   * restaurants without action
   */
  export type restaurantsDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the restaurants
     */
    select?: restaurantsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the restaurants
     */
    omit?: restaurantsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: restaurantsInclude<ExtArgs> | null
  }


  /**
   * Model spatial_ref_sys
   */

  export type AggregateSpatial_ref_sys = {
    _count: Spatial_ref_sysCountAggregateOutputType | null
    _avg: Spatial_ref_sysAvgAggregateOutputType | null
    _sum: Spatial_ref_sysSumAggregateOutputType | null
    _min: Spatial_ref_sysMinAggregateOutputType | null
    _max: Spatial_ref_sysMaxAggregateOutputType | null
  }

  export type Spatial_ref_sysAvgAggregateOutputType = {
    srid: number | null
    auth_srid: number | null
  }

  export type Spatial_ref_sysSumAggregateOutputType = {
    srid: number | null
    auth_srid: number | null
  }

  export type Spatial_ref_sysMinAggregateOutputType = {
    srid: number | null
    auth_name: string | null
    auth_srid: number | null
    srtext: string | null
    proj4text: string | null
  }

  export type Spatial_ref_sysMaxAggregateOutputType = {
    srid: number | null
    auth_name: string | null
    auth_srid: number | null
    srtext: string | null
    proj4text: string | null
  }

  export type Spatial_ref_sysCountAggregateOutputType = {
    srid: number
    auth_name: number
    auth_srid: number
    srtext: number
    proj4text: number
    _all: number
  }


  export type Spatial_ref_sysAvgAggregateInputType = {
    srid?: true
    auth_srid?: true
  }

  export type Spatial_ref_sysSumAggregateInputType = {
    srid?: true
    auth_srid?: true
  }

  export type Spatial_ref_sysMinAggregateInputType = {
    srid?: true
    auth_name?: true
    auth_srid?: true
    srtext?: true
    proj4text?: true
  }

  export type Spatial_ref_sysMaxAggregateInputType = {
    srid?: true
    auth_name?: true
    auth_srid?: true
    srtext?: true
    proj4text?: true
  }

  export type Spatial_ref_sysCountAggregateInputType = {
    srid?: true
    auth_name?: true
    auth_srid?: true
    srtext?: true
    proj4text?: true
    _all?: true
  }

  export type Spatial_ref_sysAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which spatial_ref_sys to aggregate.
     */
    where?: spatial_ref_sysWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of spatial_ref_sys to fetch.
     */
    orderBy?: spatial_ref_sysOrderByWithRelationInput | spatial_ref_sysOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: spatial_ref_sysWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` spatial_ref_sys from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` spatial_ref_sys.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned spatial_ref_sys
    **/
    _count?: true | Spatial_ref_sysCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: Spatial_ref_sysAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: Spatial_ref_sysSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: Spatial_ref_sysMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: Spatial_ref_sysMaxAggregateInputType
  }

  export type GetSpatial_ref_sysAggregateType<T extends Spatial_ref_sysAggregateArgs> = {
        [P in keyof T & keyof AggregateSpatial_ref_sys]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateSpatial_ref_sys[P]>
      : GetScalarType<T[P], AggregateSpatial_ref_sys[P]>
  }




  export type spatial_ref_sysGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: spatial_ref_sysWhereInput
    orderBy?: spatial_ref_sysOrderByWithAggregationInput | spatial_ref_sysOrderByWithAggregationInput[]
    by: Spatial_ref_sysScalarFieldEnum[] | Spatial_ref_sysScalarFieldEnum
    having?: spatial_ref_sysScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: Spatial_ref_sysCountAggregateInputType | true
    _avg?: Spatial_ref_sysAvgAggregateInputType
    _sum?: Spatial_ref_sysSumAggregateInputType
    _min?: Spatial_ref_sysMinAggregateInputType
    _max?: Spatial_ref_sysMaxAggregateInputType
  }

  export type Spatial_ref_sysGroupByOutputType = {
    srid: number
    auth_name: string | null
    auth_srid: number | null
    srtext: string | null
    proj4text: string | null
    _count: Spatial_ref_sysCountAggregateOutputType | null
    _avg: Spatial_ref_sysAvgAggregateOutputType | null
    _sum: Spatial_ref_sysSumAggregateOutputType | null
    _min: Spatial_ref_sysMinAggregateOutputType | null
    _max: Spatial_ref_sysMaxAggregateOutputType | null
  }

  type GetSpatial_ref_sysGroupByPayload<T extends spatial_ref_sysGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<Spatial_ref_sysGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof Spatial_ref_sysGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], Spatial_ref_sysGroupByOutputType[P]>
            : GetScalarType<T[P], Spatial_ref_sysGroupByOutputType[P]>
        }
      >
    >


  export type spatial_ref_sysSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    srid?: boolean
    auth_name?: boolean
    auth_srid?: boolean
    srtext?: boolean
    proj4text?: boolean
  }, ExtArgs["result"]["spatial_ref_sys"]>

  export type spatial_ref_sysSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    srid?: boolean
    auth_name?: boolean
    auth_srid?: boolean
    srtext?: boolean
    proj4text?: boolean
  }, ExtArgs["result"]["spatial_ref_sys"]>

  export type spatial_ref_sysSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    srid?: boolean
    auth_name?: boolean
    auth_srid?: boolean
    srtext?: boolean
    proj4text?: boolean
  }, ExtArgs["result"]["spatial_ref_sys"]>

  export type spatial_ref_sysSelectScalar = {
    srid?: boolean
    auth_name?: boolean
    auth_srid?: boolean
    srtext?: boolean
    proj4text?: boolean
  }

  export type spatial_ref_sysOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"srid" | "auth_name" | "auth_srid" | "srtext" | "proj4text", ExtArgs["result"]["spatial_ref_sys"]>

  export type $spatial_ref_sysPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "spatial_ref_sys"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      srid: number
      auth_name: string | null
      auth_srid: number | null
      srtext: string | null
      proj4text: string | null
    }, ExtArgs["result"]["spatial_ref_sys"]>
    composites: {}
  }

  type spatial_ref_sysGetPayload<S extends boolean | null | undefined | spatial_ref_sysDefaultArgs> = $Result.GetResult<Prisma.$spatial_ref_sysPayload, S>

  type spatial_ref_sysCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<spatial_ref_sysFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: Spatial_ref_sysCountAggregateInputType | true
    }

  export interface spatial_ref_sysDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['spatial_ref_sys'], meta: { name: 'spatial_ref_sys' } }
    /**
     * Find zero or one Spatial_ref_sys that matches the filter.
     * @param {spatial_ref_sysFindUniqueArgs} args - Arguments to find a Spatial_ref_sys
     * @example
     * // Get one Spatial_ref_sys
     * const spatial_ref_sys = await prisma.spatial_ref_sys.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends spatial_ref_sysFindUniqueArgs>(args: SelectSubset<T, spatial_ref_sysFindUniqueArgs<ExtArgs>>): Prisma__spatial_ref_sysClient<$Result.GetResult<Prisma.$spatial_ref_sysPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one Spatial_ref_sys that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {spatial_ref_sysFindUniqueOrThrowArgs} args - Arguments to find a Spatial_ref_sys
     * @example
     * // Get one Spatial_ref_sys
     * const spatial_ref_sys = await prisma.spatial_ref_sys.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends spatial_ref_sysFindUniqueOrThrowArgs>(args: SelectSubset<T, spatial_ref_sysFindUniqueOrThrowArgs<ExtArgs>>): Prisma__spatial_ref_sysClient<$Result.GetResult<Prisma.$spatial_ref_sysPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Spatial_ref_sys that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {spatial_ref_sysFindFirstArgs} args - Arguments to find a Spatial_ref_sys
     * @example
     * // Get one Spatial_ref_sys
     * const spatial_ref_sys = await prisma.spatial_ref_sys.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends spatial_ref_sysFindFirstArgs>(args?: SelectSubset<T, spatial_ref_sysFindFirstArgs<ExtArgs>>): Prisma__spatial_ref_sysClient<$Result.GetResult<Prisma.$spatial_ref_sysPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Spatial_ref_sys that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {spatial_ref_sysFindFirstOrThrowArgs} args - Arguments to find a Spatial_ref_sys
     * @example
     * // Get one Spatial_ref_sys
     * const spatial_ref_sys = await prisma.spatial_ref_sys.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends spatial_ref_sysFindFirstOrThrowArgs>(args?: SelectSubset<T, spatial_ref_sysFindFirstOrThrowArgs<ExtArgs>>): Prisma__spatial_ref_sysClient<$Result.GetResult<Prisma.$spatial_ref_sysPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more Spatial_ref_sys that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {spatial_ref_sysFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Spatial_ref_sys
     * const spatial_ref_sys = await prisma.spatial_ref_sys.findMany()
     * 
     * // Get first 10 Spatial_ref_sys
     * const spatial_ref_sys = await prisma.spatial_ref_sys.findMany({ take: 10 })
     * 
     * // Only select the `srid`
     * const spatial_ref_sysWithSridOnly = await prisma.spatial_ref_sys.findMany({ select: { srid: true } })
     * 
     */
    findMany<T extends spatial_ref_sysFindManyArgs>(args?: SelectSubset<T, spatial_ref_sysFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$spatial_ref_sysPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a Spatial_ref_sys.
     * @param {spatial_ref_sysCreateArgs} args - Arguments to create a Spatial_ref_sys.
     * @example
     * // Create one Spatial_ref_sys
     * const Spatial_ref_sys = await prisma.spatial_ref_sys.create({
     *   data: {
     *     // ... data to create a Spatial_ref_sys
     *   }
     * })
     * 
     */
    create<T extends spatial_ref_sysCreateArgs>(args: SelectSubset<T, spatial_ref_sysCreateArgs<ExtArgs>>): Prisma__spatial_ref_sysClient<$Result.GetResult<Prisma.$spatial_ref_sysPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many Spatial_ref_sys.
     * @param {spatial_ref_sysCreateManyArgs} args - Arguments to create many Spatial_ref_sys.
     * @example
     * // Create many Spatial_ref_sys
     * const spatial_ref_sys = await prisma.spatial_ref_sys.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends spatial_ref_sysCreateManyArgs>(args?: SelectSubset<T, spatial_ref_sysCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Spatial_ref_sys and returns the data saved in the database.
     * @param {spatial_ref_sysCreateManyAndReturnArgs} args - Arguments to create many Spatial_ref_sys.
     * @example
     * // Create many Spatial_ref_sys
     * const spatial_ref_sys = await prisma.spatial_ref_sys.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Spatial_ref_sys and only return the `srid`
     * const spatial_ref_sysWithSridOnly = await prisma.spatial_ref_sys.createManyAndReturn({
     *   select: { srid: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends spatial_ref_sysCreateManyAndReturnArgs>(args?: SelectSubset<T, spatial_ref_sysCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$spatial_ref_sysPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a Spatial_ref_sys.
     * @param {spatial_ref_sysDeleteArgs} args - Arguments to delete one Spatial_ref_sys.
     * @example
     * // Delete one Spatial_ref_sys
     * const Spatial_ref_sys = await prisma.spatial_ref_sys.delete({
     *   where: {
     *     // ... filter to delete one Spatial_ref_sys
     *   }
     * })
     * 
     */
    delete<T extends spatial_ref_sysDeleteArgs>(args: SelectSubset<T, spatial_ref_sysDeleteArgs<ExtArgs>>): Prisma__spatial_ref_sysClient<$Result.GetResult<Prisma.$spatial_ref_sysPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one Spatial_ref_sys.
     * @param {spatial_ref_sysUpdateArgs} args - Arguments to update one Spatial_ref_sys.
     * @example
     * // Update one Spatial_ref_sys
     * const spatial_ref_sys = await prisma.spatial_ref_sys.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends spatial_ref_sysUpdateArgs>(args: SelectSubset<T, spatial_ref_sysUpdateArgs<ExtArgs>>): Prisma__spatial_ref_sysClient<$Result.GetResult<Prisma.$spatial_ref_sysPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more Spatial_ref_sys.
     * @param {spatial_ref_sysDeleteManyArgs} args - Arguments to filter Spatial_ref_sys to delete.
     * @example
     * // Delete a few Spatial_ref_sys
     * const { count } = await prisma.spatial_ref_sys.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends spatial_ref_sysDeleteManyArgs>(args?: SelectSubset<T, spatial_ref_sysDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Spatial_ref_sys.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {spatial_ref_sysUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Spatial_ref_sys
     * const spatial_ref_sys = await prisma.spatial_ref_sys.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends spatial_ref_sysUpdateManyArgs>(args: SelectSubset<T, spatial_ref_sysUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Spatial_ref_sys and returns the data updated in the database.
     * @param {spatial_ref_sysUpdateManyAndReturnArgs} args - Arguments to update many Spatial_ref_sys.
     * @example
     * // Update many Spatial_ref_sys
     * const spatial_ref_sys = await prisma.spatial_ref_sys.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more Spatial_ref_sys and only return the `srid`
     * const spatial_ref_sysWithSridOnly = await prisma.spatial_ref_sys.updateManyAndReturn({
     *   select: { srid: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends spatial_ref_sysUpdateManyAndReturnArgs>(args: SelectSubset<T, spatial_ref_sysUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$spatial_ref_sysPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one Spatial_ref_sys.
     * @param {spatial_ref_sysUpsertArgs} args - Arguments to update or create a Spatial_ref_sys.
     * @example
     * // Update or create a Spatial_ref_sys
     * const spatial_ref_sys = await prisma.spatial_ref_sys.upsert({
     *   create: {
     *     // ... data to create a Spatial_ref_sys
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Spatial_ref_sys we want to update
     *   }
     * })
     */
    upsert<T extends spatial_ref_sysUpsertArgs>(args: SelectSubset<T, spatial_ref_sysUpsertArgs<ExtArgs>>): Prisma__spatial_ref_sysClient<$Result.GetResult<Prisma.$spatial_ref_sysPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of Spatial_ref_sys.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {spatial_ref_sysCountArgs} args - Arguments to filter Spatial_ref_sys to count.
     * @example
     * // Count the number of Spatial_ref_sys
     * const count = await prisma.spatial_ref_sys.count({
     *   where: {
     *     // ... the filter for the Spatial_ref_sys we want to count
     *   }
     * })
    **/
    count<T extends spatial_ref_sysCountArgs>(
      args?: Subset<T, spatial_ref_sysCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], Spatial_ref_sysCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Spatial_ref_sys.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Spatial_ref_sysAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends Spatial_ref_sysAggregateArgs>(args: Subset<T, Spatial_ref_sysAggregateArgs>): Prisma.PrismaPromise<GetSpatial_ref_sysAggregateType<T>>

    /**
     * Group by Spatial_ref_sys.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {spatial_ref_sysGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends spatial_ref_sysGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: spatial_ref_sysGroupByArgs['orderBy'] }
        : { orderBy?: spatial_ref_sysGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, spatial_ref_sysGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetSpatial_ref_sysGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the spatial_ref_sys model
   */
  readonly fields: spatial_ref_sysFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for spatial_ref_sys.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__spatial_ref_sysClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the spatial_ref_sys model
   */
  interface spatial_ref_sysFieldRefs {
    readonly srid: FieldRef<"spatial_ref_sys", 'Int'>
    readonly auth_name: FieldRef<"spatial_ref_sys", 'String'>
    readonly auth_srid: FieldRef<"spatial_ref_sys", 'Int'>
    readonly srtext: FieldRef<"spatial_ref_sys", 'String'>
    readonly proj4text: FieldRef<"spatial_ref_sys", 'String'>
  }
    

  // Custom InputTypes
  /**
   * spatial_ref_sys findUnique
   */
  export type spatial_ref_sysFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the spatial_ref_sys
     */
    select?: spatial_ref_sysSelect<ExtArgs> | null
    /**
     * Omit specific fields from the spatial_ref_sys
     */
    omit?: spatial_ref_sysOmit<ExtArgs> | null
    /**
     * Filter, which spatial_ref_sys to fetch.
     */
    where: spatial_ref_sysWhereUniqueInput
  }

  /**
   * spatial_ref_sys findUniqueOrThrow
   */
  export type spatial_ref_sysFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the spatial_ref_sys
     */
    select?: spatial_ref_sysSelect<ExtArgs> | null
    /**
     * Omit specific fields from the spatial_ref_sys
     */
    omit?: spatial_ref_sysOmit<ExtArgs> | null
    /**
     * Filter, which spatial_ref_sys to fetch.
     */
    where: spatial_ref_sysWhereUniqueInput
  }

  /**
   * spatial_ref_sys findFirst
   */
  export type spatial_ref_sysFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the spatial_ref_sys
     */
    select?: spatial_ref_sysSelect<ExtArgs> | null
    /**
     * Omit specific fields from the spatial_ref_sys
     */
    omit?: spatial_ref_sysOmit<ExtArgs> | null
    /**
     * Filter, which spatial_ref_sys to fetch.
     */
    where?: spatial_ref_sysWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of spatial_ref_sys to fetch.
     */
    orderBy?: spatial_ref_sysOrderByWithRelationInput | spatial_ref_sysOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for spatial_ref_sys.
     */
    cursor?: spatial_ref_sysWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` spatial_ref_sys from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` spatial_ref_sys.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of spatial_ref_sys.
     */
    distinct?: Spatial_ref_sysScalarFieldEnum | Spatial_ref_sysScalarFieldEnum[]
  }

  /**
   * spatial_ref_sys findFirstOrThrow
   */
  export type spatial_ref_sysFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the spatial_ref_sys
     */
    select?: spatial_ref_sysSelect<ExtArgs> | null
    /**
     * Omit specific fields from the spatial_ref_sys
     */
    omit?: spatial_ref_sysOmit<ExtArgs> | null
    /**
     * Filter, which spatial_ref_sys to fetch.
     */
    where?: spatial_ref_sysWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of spatial_ref_sys to fetch.
     */
    orderBy?: spatial_ref_sysOrderByWithRelationInput | spatial_ref_sysOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for spatial_ref_sys.
     */
    cursor?: spatial_ref_sysWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` spatial_ref_sys from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` spatial_ref_sys.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of spatial_ref_sys.
     */
    distinct?: Spatial_ref_sysScalarFieldEnum | Spatial_ref_sysScalarFieldEnum[]
  }

  /**
   * spatial_ref_sys findMany
   */
  export type spatial_ref_sysFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the spatial_ref_sys
     */
    select?: spatial_ref_sysSelect<ExtArgs> | null
    /**
     * Omit specific fields from the spatial_ref_sys
     */
    omit?: spatial_ref_sysOmit<ExtArgs> | null
    /**
     * Filter, which spatial_ref_sys to fetch.
     */
    where?: spatial_ref_sysWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of spatial_ref_sys to fetch.
     */
    orderBy?: spatial_ref_sysOrderByWithRelationInput | spatial_ref_sysOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing spatial_ref_sys.
     */
    cursor?: spatial_ref_sysWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` spatial_ref_sys from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` spatial_ref_sys.
     */
    skip?: number
    distinct?: Spatial_ref_sysScalarFieldEnum | Spatial_ref_sysScalarFieldEnum[]
  }

  /**
   * spatial_ref_sys create
   */
  export type spatial_ref_sysCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the spatial_ref_sys
     */
    select?: spatial_ref_sysSelect<ExtArgs> | null
    /**
     * Omit specific fields from the spatial_ref_sys
     */
    omit?: spatial_ref_sysOmit<ExtArgs> | null
    /**
     * The data needed to create a spatial_ref_sys.
     */
    data: XOR<spatial_ref_sysCreateInput, spatial_ref_sysUncheckedCreateInput>
  }

  /**
   * spatial_ref_sys createMany
   */
  export type spatial_ref_sysCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many spatial_ref_sys.
     */
    data: spatial_ref_sysCreateManyInput | spatial_ref_sysCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * spatial_ref_sys createManyAndReturn
   */
  export type spatial_ref_sysCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the spatial_ref_sys
     */
    select?: spatial_ref_sysSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the spatial_ref_sys
     */
    omit?: spatial_ref_sysOmit<ExtArgs> | null
    /**
     * The data used to create many spatial_ref_sys.
     */
    data: spatial_ref_sysCreateManyInput | spatial_ref_sysCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * spatial_ref_sys update
   */
  export type spatial_ref_sysUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the spatial_ref_sys
     */
    select?: spatial_ref_sysSelect<ExtArgs> | null
    /**
     * Omit specific fields from the spatial_ref_sys
     */
    omit?: spatial_ref_sysOmit<ExtArgs> | null
    /**
     * The data needed to update a spatial_ref_sys.
     */
    data: XOR<spatial_ref_sysUpdateInput, spatial_ref_sysUncheckedUpdateInput>
    /**
     * Choose, which spatial_ref_sys to update.
     */
    where: spatial_ref_sysWhereUniqueInput
  }

  /**
   * spatial_ref_sys updateMany
   */
  export type spatial_ref_sysUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update spatial_ref_sys.
     */
    data: XOR<spatial_ref_sysUpdateManyMutationInput, spatial_ref_sysUncheckedUpdateManyInput>
    /**
     * Filter which spatial_ref_sys to update
     */
    where?: spatial_ref_sysWhereInput
    /**
     * Limit how many spatial_ref_sys to update.
     */
    limit?: number
  }

  /**
   * spatial_ref_sys updateManyAndReturn
   */
  export type spatial_ref_sysUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the spatial_ref_sys
     */
    select?: spatial_ref_sysSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the spatial_ref_sys
     */
    omit?: spatial_ref_sysOmit<ExtArgs> | null
    /**
     * The data used to update spatial_ref_sys.
     */
    data: XOR<spatial_ref_sysUpdateManyMutationInput, spatial_ref_sysUncheckedUpdateManyInput>
    /**
     * Filter which spatial_ref_sys to update
     */
    where?: spatial_ref_sysWhereInput
    /**
     * Limit how many spatial_ref_sys to update.
     */
    limit?: number
  }

  /**
   * spatial_ref_sys upsert
   */
  export type spatial_ref_sysUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the spatial_ref_sys
     */
    select?: spatial_ref_sysSelect<ExtArgs> | null
    /**
     * Omit specific fields from the spatial_ref_sys
     */
    omit?: spatial_ref_sysOmit<ExtArgs> | null
    /**
     * The filter to search for the spatial_ref_sys to update in case it exists.
     */
    where: spatial_ref_sysWhereUniqueInput
    /**
     * In case the spatial_ref_sys found by the `where` argument doesn't exist, create a new spatial_ref_sys with this data.
     */
    create: XOR<spatial_ref_sysCreateInput, spatial_ref_sysUncheckedCreateInput>
    /**
     * In case the spatial_ref_sys was found with the provided `where` argument, update it with this data.
     */
    update: XOR<spatial_ref_sysUpdateInput, spatial_ref_sysUncheckedUpdateInput>
  }

  /**
   * spatial_ref_sys delete
   */
  export type spatial_ref_sysDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the spatial_ref_sys
     */
    select?: spatial_ref_sysSelect<ExtArgs> | null
    /**
     * Omit specific fields from the spatial_ref_sys
     */
    omit?: spatial_ref_sysOmit<ExtArgs> | null
    /**
     * Filter which spatial_ref_sys to delete.
     */
    where: spatial_ref_sysWhereUniqueInput
  }

  /**
   * spatial_ref_sys deleteMany
   */
  export type spatial_ref_sysDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which spatial_ref_sys to delete
     */
    where?: spatial_ref_sysWhereInput
    /**
     * Limit how many spatial_ref_sys to delete.
     */
    limit?: number
  }

  /**
   * spatial_ref_sys without action
   */
  export type spatial_ref_sysDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the spatial_ref_sys
     */
    select?: spatial_ref_sysSelect<ExtArgs> | null
    /**
     * Omit specific fields from the spatial_ref_sys
     */
    omit?: spatial_ref_sysOmit<ExtArgs> | null
  }


  /**
   * Model users
   */

  export type AggregateUsers = {
    _count: UsersCountAggregateOutputType | null
    _avg: UsersAvgAggregateOutputType | null
    _sum: UsersSumAggregateOutputType | null
    _min: UsersMinAggregateOutputType | null
    _max: UsersMaxAggregateOutputType | null
  }

  export type UsersAvgAggregateOutputType = {
    lock_no: number | null
  }

  export type UsersSumAggregateOutputType = {
    lock_no: number | null
  }

  export type UsersMinAggregateOutputType = {
    id: string | null
    username: string | null
    display_name: string | null
    avatar: string | null
    bio: string | null
    last_login_at: Date | null
    created_at: Date | null
    updated_at: Date | null
    lock_no: number | null
  }

  export type UsersMaxAggregateOutputType = {
    id: string | null
    username: string | null
    display_name: string | null
    avatar: string | null
    bio: string | null
    last_login_at: Date | null
    created_at: Date | null
    updated_at: Date | null
    lock_no: number | null
  }

  export type UsersCountAggregateOutputType = {
    id: number
    username: number
    display_name: number
    avatar: number
    bio: number
    last_login_at: number
    created_at: number
    updated_at: number
    lock_no: number
    _all: number
  }


  export type UsersAvgAggregateInputType = {
    lock_no?: true
  }

  export type UsersSumAggregateInputType = {
    lock_no?: true
  }

  export type UsersMinAggregateInputType = {
    id?: true
    username?: true
    display_name?: true
    avatar?: true
    bio?: true
    last_login_at?: true
    created_at?: true
    updated_at?: true
    lock_no?: true
  }

  export type UsersMaxAggregateInputType = {
    id?: true
    username?: true
    display_name?: true
    avatar?: true
    bio?: true
    last_login_at?: true
    created_at?: true
    updated_at?: true
    lock_no?: true
  }

  export type UsersCountAggregateInputType = {
    id?: true
    username?: true
    display_name?: true
    avatar?: true
    bio?: true
    last_login_at?: true
    created_at?: true
    updated_at?: true
    lock_no?: true
    _all?: true
  }

  export type UsersAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which users to aggregate.
     */
    where?: usersWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of users to fetch.
     */
    orderBy?: usersOrderByWithRelationInput | usersOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: usersWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` users from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` users.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned users
    **/
    _count?: true | UsersCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: UsersAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: UsersSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: UsersMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: UsersMaxAggregateInputType
  }

  export type GetUsersAggregateType<T extends UsersAggregateArgs> = {
        [P in keyof T & keyof AggregateUsers]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateUsers[P]>
      : GetScalarType<T[P], AggregateUsers[P]>
  }




  export type usersGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: usersWhereInput
    orderBy?: usersOrderByWithAggregationInput | usersOrderByWithAggregationInput[]
    by: UsersScalarFieldEnum[] | UsersScalarFieldEnum
    having?: usersScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: UsersCountAggregateInputType | true
    _avg?: UsersAvgAggregateInputType
    _sum?: UsersSumAggregateInputType
    _min?: UsersMinAggregateInputType
    _max?: UsersMaxAggregateInputType
  }

  export type UsersGroupByOutputType = {
    id: string
    username: string
    display_name: string | null
    avatar: string | null
    bio: string | null
    last_login_at: Date | null
    created_at: Date
    updated_at: Date
    lock_no: number
    _count: UsersCountAggregateOutputType | null
    _avg: UsersAvgAggregateOutputType | null
    _sum: UsersSumAggregateOutputType | null
    _min: UsersMinAggregateOutputType | null
    _max: UsersMaxAggregateOutputType | null
  }

  type GetUsersGroupByPayload<T extends usersGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<UsersGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof UsersGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], UsersGroupByOutputType[P]>
            : GetScalarType<T[P], UsersGroupByOutputType[P]>
        }
      >
    >


  export type usersSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    username?: boolean
    display_name?: boolean
    avatar?: boolean
    bio?: boolean
    last_login_at?: boolean
    created_at?: boolean
    updated_at?: boolean
    lock_no?: boolean
    dish_likes?: boolean | users$dish_likesArgs<ExtArgs>
    dish_media?: boolean | users$dish_mediaArgs<ExtArgs>
    dish_reviews?: boolean | users$dish_reviewsArgs<ExtArgs>
    restaurant_bids?: boolean | users$restaurant_bidsArgs<ExtArgs>
    _count?: boolean | UsersCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["users"]>

  export type usersSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    username?: boolean
    display_name?: boolean
    avatar?: boolean
    bio?: boolean
    last_login_at?: boolean
    created_at?: boolean
    updated_at?: boolean
    lock_no?: boolean
  }, ExtArgs["result"]["users"]>

  export type usersSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    username?: boolean
    display_name?: boolean
    avatar?: boolean
    bio?: boolean
    last_login_at?: boolean
    created_at?: boolean
    updated_at?: boolean
    lock_no?: boolean
  }, ExtArgs["result"]["users"]>

  export type usersSelectScalar = {
    id?: boolean
    username?: boolean
    display_name?: boolean
    avatar?: boolean
    bio?: boolean
    last_login_at?: boolean
    created_at?: boolean
    updated_at?: boolean
    lock_no?: boolean
  }

  export type usersOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "username" | "display_name" | "avatar" | "bio" | "last_login_at" | "created_at" | "updated_at" | "lock_no", ExtArgs["result"]["users"]>
  export type usersInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    dish_likes?: boolean | users$dish_likesArgs<ExtArgs>
    dish_media?: boolean | users$dish_mediaArgs<ExtArgs>
    dish_reviews?: boolean | users$dish_reviewsArgs<ExtArgs>
    restaurant_bids?: boolean | users$restaurant_bidsArgs<ExtArgs>
    _count?: boolean | UsersCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type usersIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}
  export type usersIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}

  export type $usersPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "users"
    objects: {
      dish_likes: Prisma.$dish_likesPayload<ExtArgs>[]
      dish_media: Prisma.$dish_mediaPayload<ExtArgs>[]
      dish_reviews: Prisma.$dish_reviewsPayload<ExtArgs>[]
      restaurant_bids: Prisma.$restaurant_bidsPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      username: string
      display_name: string | null
      avatar: string | null
      bio: string | null
      last_login_at: Date | null
      created_at: Date
      updated_at: Date
      lock_no: number
    }, ExtArgs["result"]["users"]>
    composites: {}
  }

  type usersGetPayload<S extends boolean | null | undefined | usersDefaultArgs> = $Result.GetResult<Prisma.$usersPayload, S>

  type usersCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<usersFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: UsersCountAggregateInputType | true
    }

  export interface usersDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['users'], meta: { name: 'users' } }
    /**
     * Find zero or one Users that matches the filter.
     * @param {usersFindUniqueArgs} args - Arguments to find a Users
     * @example
     * // Get one Users
     * const users = await prisma.users.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends usersFindUniqueArgs>(args: SelectSubset<T, usersFindUniqueArgs<ExtArgs>>): Prisma__usersClient<$Result.GetResult<Prisma.$usersPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one Users that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {usersFindUniqueOrThrowArgs} args - Arguments to find a Users
     * @example
     * // Get one Users
     * const users = await prisma.users.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends usersFindUniqueOrThrowArgs>(args: SelectSubset<T, usersFindUniqueOrThrowArgs<ExtArgs>>): Prisma__usersClient<$Result.GetResult<Prisma.$usersPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Users that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {usersFindFirstArgs} args - Arguments to find a Users
     * @example
     * // Get one Users
     * const users = await prisma.users.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends usersFindFirstArgs>(args?: SelectSubset<T, usersFindFirstArgs<ExtArgs>>): Prisma__usersClient<$Result.GetResult<Prisma.$usersPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Users that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {usersFindFirstOrThrowArgs} args - Arguments to find a Users
     * @example
     * // Get one Users
     * const users = await prisma.users.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends usersFindFirstOrThrowArgs>(args?: SelectSubset<T, usersFindFirstOrThrowArgs<ExtArgs>>): Prisma__usersClient<$Result.GetResult<Prisma.$usersPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more Users that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {usersFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Users
     * const users = await prisma.users.findMany()
     * 
     * // Get first 10 Users
     * const users = await prisma.users.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const usersWithIdOnly = await prisma.users.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends usersFindManyArgs>(args?: SelectSubset<T, usersFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$usersPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a Users.
     * @param {usersCreateArgs} args - Arguments to create a Users.
     * @example
     * // Create one Users
     * const Users = await prisma.users.create({
     *   data: {
     *     // ... data to create a Users
     *   }
     * })
     * 
     */
    create<T extends usersCreateArgs>(args: SelectSubset<T, usersCreateArgs<ExtArgs>>): Prisma__usersClient<$Result.GetResult<Prisma.$usersPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many Users.
     * @param {usersCreateManyArgs} args - Arguments to create many Users.
     * @example
     * // Create many Users
     * const users = await prisma.users.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends usersCreateManyArgs>(args?: SelectSubset<T, usersCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Users and returns the data saved in the database.
     * @param {usersCreateManyAndReturnArgs} args - Arguments to create many Users.
     * @example
     * // Create many Users
     * const users = await prisma.users.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Users and only return the `id`
     * const usersWithIdOnly = await prisma.users.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends usersCreateManyAndReturnArgs>(args?: SelectSubset<T, usersCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$usersPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a Users.
     * @param {usersDeleteArgs} args - Arguments to delete one Users.
     * @example
     * // Delete one Users
     * const Users = await prisma.users.delete({
     *   where: {
     *     // ... filter to delete one Users
     *   }
     * })
     * 
     */
    delete<T extends usersDeleteArgs>(args: SelectSubset<T, usersDeleteArgs<ExtArgs>>): Prisma__usersClient<$Result.GetResult<Prisma.$usersPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one Users.
     * @param {usersUpdateArgs} args - Arguments to update one Users.
     * @example
     * // Update one Users
     * const users = await prisma.users.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends usersUpdateArgs>(args: SelectSubset<T, usersUpdateArgs<ExtArgs>>): Prisma__usersClient<$Result.GetResult<Prisma.$usersPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more Users.
     * @param {usersDeleteManyArgs} args - Arguments to filter Users to delete.
     * @example
     * // Delete a few Users
     * const { count } = await prisma.users.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends usersDeleteManyArgs>(args?: SelectSubset<T, usersDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Users.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {usersUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Users
     * const users = await prisma.users.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends usersUpdateManyArgs>(args: SelectSubset<T, usersUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Users and returns the data updated in the database.
     * @param {usersUpdateManyAndReturnArgs} args - Arguments to update many Users.
     * @example
     * // Update many Users
     * const users = await prisma.users.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more Users and only return the `id`
     * const usersWithIdOnly = await prisma.users.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends usersUpdateManyAndReturnArgs>(args: SelectSubset<T, usersUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$usersPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one Users.
     * @param {usersUpsertArgs} args - Arguments to update or create a Users.
     * @example
     * // Update or create a Users
     * const users = await prisma.users.upsert({
     *   create: {
     *     // ... data to create a Users
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Users we want to update
     *   }
     * })
     */
    upsert<T extends usersUpsertArgs>(args: SelectSubset<T, usersUpsertArgs<ExtArgs>>): Prisma__usersClient<$Result.GetResult<Prisma.$usersPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of Users.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {usersCountArgs} args - Arguments to filter Users to count.
     * @example
     * // Count the number of Users
     * const count = await prisma.users.count({
     *   where: {
     *     // ... the filter for the Users we want to count
     *   }
     * })
    **/
    count<T extends usersCountArgs>(
      args?: Subset<T, usersCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], UsersCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Users.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UsersAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends UsersAggregateArgs>(args: Subset<T, UsersAggregateArgs>): Prisma.PrismaPromise<GetUsersAggregateType<T>>

    /**
     * Group by Users.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {usersGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends usersGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: usersGroupByArgs['orderBy'] }
        : { orderBy?: usersGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, usersGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetUsersGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the users model
   */
  readonly fields: usersFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for users.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__usersClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    dish_likes<T extends users$dish_likesArgs<ExtArgs> = {}>(args?: Subset<T, users$dish_likesArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$dish_likesPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    dish_media<T extends users$dish_mediaArgs<ExtArgs> = {}>(args?: Subset<T, users$dish_mediaArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$dish_mediaPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    dish_reviews<T extends users$dish_reviewsArgs<ExtArgs> = {}>(args?: Subset<T, users$dish_reviewsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$dish_reviewsPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    restaurant_bids<T extends users$restaurant_bidsArgs<ExtArgs> = {}>(args?: Subset<T, users$restaurant_bidsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$restaurant_bidsPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the users model
   */
  interface usersFieldRefs {
    readonly id: FieldRef<"users", 'String'>
    readonly username: FieldRef<"users", 'String'>
    readonly display_name: FieldRef<"users", 'String'>
    readonly avatar: FieldRef<"users", 'String'>
    readonly bio: FieldRef<"users", 'String'>
    readonly last_login_at: FieldRef<"users", 'DateTime'>
    readonly created_at: FieldRef<"users", 'DateTime'>
    readonly updated_at: FieldRef<"users", 'DateTime'>
    readonly lock_no: FieldRef<"users", 'Int'>
  }
    

  // Custom InputTypes
  /**
   * users findUnique
   */
  export type usersFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the users
     */
    select?: usersSelect<ExtArgs> | null
    /**
     * Omit specific fields from the users
     */
    omit?: usersOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: usersInclude<ExtArgs> | null
    /**
     * Filter, which users to fetch.
     */
    where: usersWhereUniqueInput
  }

  /**
   * users findUniqueOrThrow
   */
  export type usersFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the users
     */
    select?: usersSelect<ExtArgs> | null
    /**
     * Omit specific fields from the users
     */
    omit?: usersOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: usersInclude<ExtArgs> | null
    /**
     * Filter, which users to fetch.
     */
    where: usersWhereUniqueInput
  }

  /**
   * users findFirst
   */
  export type usersFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the users
     */
    select?: usersSelect<ExtArgs> | null
    /**
     * Omit specific fields from the users
     */
    omit?: usersOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: usersInclude<ExtArgs> | null
    /**
     * Filter, which users to fetch.
     */
    where?: usersWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of users to fetch.
     */
    orderBy?: usersOrderByWithRelationInput | usersOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for users.
     */
    cursor?: usersWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` users from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` users.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of users.
     */
    distinct?: UsersScalarFieldEnum | UsersScalarFieldEnum[]
  }

  /**
   * users findFirstOrThrow
   */
  export type usersFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the users
     */
    select?: usersSelect<ExtArgs> | null
    /**
     * Omit specific fields from the users
     */
    omit?: usersOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: usersInclude<ExtArgs> | null
    /**
     * Filter, which users to fetch.
     */
    where?: usersWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of users to fetch.
     */
    orderBy?: usersOrderByWithRelationInput | usersOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for users.
     */
    cursor?: usersWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` users from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` users.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of users.
     */
    distinct?: UsersScalarFieldEnum | UsersScalarFieldEnum[]
  }

  /**
   * users findMany
   */
  export type usersFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the users
     */
    select?: usersSelect<ExtArgs> | null
    /**
     * Omit specific fields from the users
     */
    omit?: usersOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: usersInclude<ExtArgs> | null
    /**
     * Filter, which users to fetch.
     */
    where?: usersWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of users to fetch.
     */
    orderBy?: usersOrderByWithRelationInput | usersOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing users.
     */
    cursor?: usersWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` users from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` users.
     */
    skip?: number
    distinct?: UsersScalarFieldEnum | UsersScalarFieldEnum[]
  }

  /**
   * users create
   */
  export type usersCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the users
     */
    select?: usersSelect<ExtArgs> | null
    /**
     * Omit specific fields from the users
     */
    omit?: usersOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: usersInclude<ExtArgs> | null
    /**
     * The data needed to create a users.
     */
    data: XOR<usersCreateInput, usersUncheckedCreateInput>
  }

  /**
   * users createMany
   */
  export type usersCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many users.
     */
    data: usersCreateManyInput | usersCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * users createManyAndReturn
   */
  export type usersCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the users
     */
    select?: usersSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the users
     */
    omit?: usersOmit<ExtArgs> | null
    /**
     * The data used to create many users.
     */
    data: usersCreateManyInput | usersCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * users update
   */
  export type usersUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the users
     */
    select?: usersSelect<ExtArgs> | null
    /**
     * Omit specific fields from the users
     */
    omit?: usersOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: usersInclude<ExtArgs> | null
    /**
     * The data needed to update a users.
     */
    data: XOR<usersUpdateInput, usersUncheckedUpdateInput>
    /**
     * Choose, which users to update.
     */
    where: usersWhereUniqueInput
  }

  /**
   * users updateMany
   */
  export type usersUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update users.
     */
    data: XOR<usersUpdateManyMutationInput, usersUncheckedUpdateManyInput>
    /**
     * Filter which users to update
     */
    where?: usersWhereInput
    /**
     * Limit how many users to update.
     */
    limit?: number
  }

  /**
   * users updateManyAndReturn
   */
  export type usersUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the users
     */
    select?: usersSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the users
     */
    omit?: usersOmit<ExtArgs> | null
    /**
     * The data used to update users.
     */
    data: XOR<usersUpdateManyMutationInput, usersUncheckedUpdateManyInput>
    /**
     * Filter which users to update
     */
    where?: usersWhereInput
    /**
     * Limit how many users to update.
     */
    limit?: number
  }

  /**
   * users upsert
   */
  export type usersUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the users
     */
    select?: usersSelect<ExtArgs> | null
    /**
     * Omit specific fields from the users
     */
    omit?: usersOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: usersInclude<ExtArgs> | null
    /**
     * The filter to search for the users to update in case it exists.
     */
    where: usersWhereUniqueInput
    /**
     * In case the users found by the `where` argument doesn't exist, create a new users with this data.
     */
    create: XOR<usersCreateInput, usersUncheckedCreateInput>
    /**
     * In case the users was found with the provided `where` argument, update it with this data.
     */
    update: XOR<usersUpdateInput, usersUncheckedUpdateInput>
  }

  /**
   * users delete
   */
  export type usersDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the users
     */
    select?: usersSelect<ExtArgs> | null
    /**
     * Omit specific fields from the users
     */
    omit?: usersOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: usersInclude<ExtArgs> | null
    /**
     * Filter which users to delete.
     */
    where: usersWhereUniqueInput
  }

  /**
   * users deleteMany
   */
  export type usersDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which users to delete
     */
    where?: usersWhereInput
    /**
     * Limit how many users to delete.
     */
    limit?: number
  }

  /**
   * users.dish_likes
   */
  export type users$dish_likesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_likes
     */
    select?: dish_likesSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_likes
     */
    omit?: dish_likesOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_likesInclude<ExtArgs> | null
    where?: dish_likesWhereInput
    orderBy?: dish_likesOrderByWithRelationInput | dish_likesOrderByWithRelationInput[]
    cursor?: dish_likesWhereUniqueInput
    take?: number
    skip?: number
    distinct?: Dish_likesScalarFieldEnum | Dish_likesScalarFieldEnum[]
  }

  /**
   * users.dish_media
   */
  export type users$dish_mediaArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_media
     */
    select?: dish_mediaSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_media
     */
    omit?: dish_mediaOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_mediaInclude<ExtArgs> | null
    where?: dish_mediaWhereInput
    orderBy?: dish_mediaOrderByWithRelationInput | dish_mediaOrderByWithRelationInput[]
    cursor?: dish_mediaWhereUniqueInput
    take?: number
    skip?: number
    distinct?: Dish_mediaScalarFieldEnum | Dish_mediaScalarFieldEnum[]
  }

  /**
   * users.dish_reviews
   */
  export type users$dish_reviewsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the dish_reviews
     */
    select?: dish_reviewsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the dish_reviews
     */
    omit?: dish_reviewsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: dish_reviewsInclude<ExtArgs> | null
    where?: dish_reviewsWhereInput
    orderBy?: dish_reviewsOrderByWithRelationInput | dish_reviewsOrderByWithRelationInput[]
    cursor?: dish_reviewsWhereUniqueInput
    take?: number
    skip?: number
    distinct?: Dish_reviewsScalarFieldEnum | Dish_reviewsScalarFieldEnum[]
  }

  /**
   * users.restaurant_bids
   */
  export type users$restaurant_bidsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the restaurant_bids
     */
    select?: restaurant_bidsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the restaurant_bids
     */
    omit?: restaurant_bidsOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: restaurant_bidsInclude<ExtArgs> | null
    where?: restaurant_bidsWhereInput
    orderBy?: restaurant_bidsOrderByWithRelationInput | restaurant_bidsOrderByWithRelationInput[]
    cursor?: restaurant_bidsWhereUniqueInput
    take?: number
    skip?: number
    distinct?: Restaurant_bidsScalarFieldEnum | Restaurant_bidsScalarFieldEnum[]
  }

  /**
   * users without action
   */
  export type usersDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the users
     */
    select?: usersSelect<ExtArgs> | null
    /**
     * Omit specific fields from the users
     */
    omit?: usersOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: usersInclude<ExtArgs> | null
  }


  /**
   * Enums
   */

  export const TransactionIsolationLevel: {
    ReadUncommitted: 'ReadUncommitted',
    ReadCommitted: 'ReadCommitted',
    RepeatableRead: 'RepeatableRead',
    Serializable: 'Serializable'
  };

  export type TransactionIsolationLevel = (typeof TransactionIsolationLevel)[keyof typeof TransactionIsolationLevel]


  export const Dish_categoriesScalarFieldEnum: {
    id: 'id',
    label_en: 'label_en',
    labels: 'labels',
    image_url: 'image_url',
    origin: 'origin',
    cuisine: 'cuisine',
    tags: 'tags',
    created_at: 'created_at',
    updated_at: 'updated_at',
    lock_no: 'lock_no'
  };

  export type Dish_categoriesScalarFieldEnum = (typeof Dish_categoriesScalarFieldEnum)[keyof typeof Dish_categoriesScalarFieldEnum]


  export const Dish_category_variantsScalarFieldEnum: {
    id: 'id',
    dish_category_id: 'dish_category_id',
    surface_form: 'surface_form',
    source: 'source',
    created_at: 'created_at'
  };

  export type Dish_category_variantsScalarFieldEnum = (typeof Dish_category_variantsScalarFieldEnum)[keyof typeof Dish_category_variantsScalarFieldEnum]


  export const Dish_likesScalarFieldEnum: {
    id: 'id',
    dish_media_id: 'dish_media_id',
    user_id: 'user_id',
    created_at: 'created_at'
  };

  export type Dish_likesScalarFieldEnum = (typeof Dish_likesScalarFieldEnum)[keyof typeof Dish_likesScalarFieldEnum]


  export const Dish_mediaScalarFieldEnum: {
    id: 'id',
    dish_id: 'dish_id',
    user_id: 'user_id',
    media_path: 'media_path',
    media_type: 'media_type',
    thumbnail_path: 'thumbnail_path',
    created_at: 'created_at',
    updated_at: 'updated_at',
    lock_no: 'lock_no'
  };

  export type Dish_mediaScalarFieldEnum = (typeof Dish_mediaScalarFieldEnum)[keyof typeof Dish_mediaScalarFieldEnum]


  export const Dish_reviewsScalarFieldEnum: {
    id: 'id',
    dish_id: 'dish_id',
    comment: 'comment',
    user_id: 'user_id',
    rating: 'rating',
    price_cents: 'price_cents',
    currency_code: 'currency_code',
    created_dish_media_id: 'created_dish_media_id',
    imported_user_name: 'imported_user_name',
    imported_user_avatar: 'imported_user_avatar',
    created_at: 'created_at'
  };

  export type Dish_reviewsScalarFieldEnum = (typeof Dish_reviewsScalarFieldEnum)[keyof typeof Dish_reviewsScalarFieldEnum]


  export const DishesScalarFieldEnum: {
    id: 'id',
    restaurant_id: 'restaurant_id',
    category_id: 'category_id',
    name: 'name',
    created_at: 'created_at',
    updated_at: 'updated_at',
    lock_no: 'lock_no'
  };

  export type DishesScalarFieldEnum = (typeof DishesScalarFieldEnum)[keyof typeof DishesScalarFieldEnum]


  export const PayoutsScalarFieldEnum: {
    id: 'id',
    bid_id: 'bid_id',
    transfer_id: 'transfer_id',
    dish_media_id: 'dish_media_id',
    amount_cents: 'amount_cents',
    currency_code: 'currency_code',
    status: 'status',
    created_at: 'created_at',
    updated_at: 'updated_at',
    lock_no: 'lock_no'
  };

  export type PayoutsScalarFieldEnum = (typeof PayoutsScalarFieldEnum)[keyof typeof PayoutsScalarFieldEnum]


  export const Restaurant_bidsScalarFieldEnum: {
    id: 'id',
    restaurant_id: 'restaurant_id',
    user_id: 'user_id',
    payment_intent_id: 'payment_intent_id',
    amount_cents: 'amount_cents',
    currency_code: 'currency_code',
    start_date: 'start_date',
    end_date: 'end_date',
    status: 'status',
    refund_id: 'refund_id',
    created_at: 'created_at',
    updated_at: 'updated_at',
    lock_no: 'lock_no'
  };

  export type Restaurant_bidsScalarFieldEnum = (typeof Restaurant_bidsScalarFieldEnum)[keyof typeof Restaurant_bidsScalarFieldEnum]


  export const RestaurantsScalarFieldEnum: {
    id: 'id',
    google_place_id: 'google_place_id',
    name: 'name',
    image_url: 'image_url',
    created_at: 'created_at'
  };

  export type RestaurantsScalarFieldEnum = (typeof RestaurantsScalarFieldEnum)[keyof typeof RestaurantsScalarFieldEnum]


  export const Spatial_ref_sysScalarFieldEnum: {
    srid: 'srid',
    auth_name: 'auth_name',
    auth_srid: 'auth_srid',
    srtext: 'srtext',
    proj4text: 'proj4text'
  };

  export type Spatial_ref_sysScalarFieldEnum = (typeof Spatial_ref_sysScalarFieldEnum)[keyof typeof Spatial_ref_sysScalarFieldEnum]


  export const UsersScalarFieldEnum: {
    id: 'id',
    username: 'username',
    display_name: 'display_name',
    avatar: 'avatar',
    bio: 'bio',
    last_login_at: 'last_login_at',
    created_at: 'created_at',
    updated_at: 'updated_at',
    lock_no: 'lock_no'
  };

  export type UsersScalarFieldEnum = (typeof UsersScalarFieldEnum)[keyof typeof UsersScalarFieldEnum]


  export const SortOrder: {
    asc: 'asc',
    desc: 'desc'
  };

  export type SortOrder = (typeof SortOrder)[keyof typeof SortOrder]


  export const JsonNullValueInput: {
    JsonNull: typeof JsonNull
  };

  export type JsonNullValueInput = (typeof JsonNullValueInput)[keyof typeof JsonNullValueInput]


  export const QueryMode: {
    default: 'default',
    insensitive: 'insensitive'
  };

  export type QueryMode = (typeof QueryMode)[keyof typeof QueryMode]


  export const JsonNullValueFilter: {
    DbNull: typeof DbNull,
    JsonNull: typeof JsonNull,
    AnyNull: typeof AnyNull
  };

  export type JsonNullValueFilter = (typeof JsonNullValueFilter)[keyof typeof JsonNullValueFilter]


  export const NullsOrder: {
    first: 'first',
    last: 'last'
  };

  export type NullsOrder = (typeof NullsOrder)[keyof typeof NullsOrder]


  /**
   * Field references
   */


  /**
   * Reference to a field of type 'String'
   */
  export type StringFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'String'>
    


  /**
   * Reference to a field of type 'String[]'
   */
  export type ListStringFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'String[]'>
    


  /**
   * Reference to a field of type 'Json'
   */
  export type JsonFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Json'>
    


  /**
   * Reference to a field of type 'QueryMode'
   */
  export type EnumQueryModeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'QueryMode'>
    


  /**
   * Reference to a field of type 'DateTime'
   */
  export type DateTimeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'DateTime'>
    


  /**
   * Reference to a field of type 'DateTime[]'
   */
  export type ListDateTimeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'DateTime[]'>
    


  /**
   * Reference to a field of type 'Int'
   */
  export type IntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Int'>
    


  /**
   * Reference to a field of type 'Int[]'
   */
  export type ListIntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Int[]'>
    


  /**
   * Reference to a field of type 'BigInt'
   */
  export type BigIntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'BigInt'>
    


  /**
   * Reference to a field of type 'BigInt[]'
   */
  export type ListBigIntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'BigInt[]'>
    


  /**
   * Reference to a field of type 'payout_status'
   */
  export type Enumpayout_statusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'payout_status'>
    


  /**
   * Reference to a field of type 'payout_status[]'
   */
  export type ListEnumpayout_statusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'payout_status[]'>
    


  /**
   * Reference to a field of type 'restaurant_bid_status'
   */
  export type Enumrestaurant_bid_statusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'restaurant_bid_status'>
    


  /**
   * Reference to a field of type 'restaurant_bid_status[]'
   */
  export type ListEnumrestaurant_bid_statusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'restaurant_bid_status[]'>
    


  /**
   * Reference to a field of type 'Float'
   */
  export type FloatFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Float'>
    


  /**
   * Reference to a field of type 'Float[]'
   */
  export type ListFloatFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Float[]'>
    
  /**
   * Deep Input Types
   */


  export type dish_categoriesWhereInput = {
    AND?: dish_categoriesWhereInput | dish_categoriesWhereInput[]
    OR?: dish_categoriesWhereInput[]
    NOT?: dish_categoriesWhereInput | dish_categoriesWhereInput[]
    id?: StringFilter<"dish_categories"> | string
    label_en?: StringFilter<"dish_categories"> | string
    labels?: JsonFilter<"dish_categories">
    image_url?: StringFilter<"dish_categories"> | string
    origin?: StringNullableListFilter<"dish_categories">
    cuisine?: StringNullableListFilter<"dish_categories">
    tags?: StringNullableListFilter<"dish_categories">
    created_at?: DateTimeFilter<"dish_categories"> | Date | string
    updated_at?: DateTimeFilter<"dish_categories"> | Date | string
    lock_no?: IntFilter<"dish_categories"> | number
    dish_category_variants?: Dish_category_variantsListRelationFilter
    dishes?: DishesListRelationFilter
  }

  export type dish_categoriesOrderByWithRelationInput = {
    id?: SortOrder
    label_en?: SortOrder
    labels?: SortOrder
    image_url?: SortOrder
    origin?: SortOrder
    cuisine?: SortOrder
    tags?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    lock_no?: SortOrder
    dish_category_variants?: dish_category_variantsOrderByRelationAggregateInput
    dishes?: dishesOrderByRelationAggregateInput
  }

  export type dish_categoriesWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: dish_categoriesWhereInput | dish_categoriesWhereInput[]
    OR?: dish_categoriesWhereInput[]
    NOT?: dish_categoriesWhereInput | dish_categoriesWhereInput[]
    label_en?: StringFilter<"dish_categories"> | string
    labels?: JsonFilter<"dish_categories">
    image_url?: StringFilter<"dish_categories"> | string
    origin?: StringNullableListFilter<"dish_categories">
    cuisine?: StringNullableListFilter<"dish_categories">
    tags?: StringNullableListFilter<"dish_categories">
    created_at?: DateTimeFilter<"dish_categories"> | Date | string
    updated_at?: DateTimeFilter<"dish_categories"> | Date | string
    lock_no?: IntFilter<"dish_categories"> | number
    dish_category_variants?: Dish_category_variantsListRelationFilter
    dishes?: DishesListRelationFilter
  }, "id">

  export type dish_categoriesOrderByWithAggregationInput = {
    id?: SortOrder
    label_en?: SortOrder
    labels?: SortOrder
    image_url?: SortOrder
    origin?: SortOrder
    cuisine?: SortOrder
    tags?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    lock_no?: SortOrder
    _count?: dish_categoriesCountOrderByAggregateInput
    _avg?: dish_categoriesAvgOrderByAggregateInput
    _max?: dish_categoriesMaxOrderByAggregateInput
    _min?: dish_categoriesMinOrderByAggregateInput
    _sum?: dish_categoriesSumOrderByAggregateInput
  }

  export type dish_categoriesScalarWhereWithAggregatesInput = {
    AND?: dish_categoriesScalarWhereWithAggregatesInput | dish_categoriesScalarWhereWithAggregatesInput[]
    OR?: dish_categoriesScalarWhereWithAggregatesInput[]
    NOT?: dish_categoriesScalarWhereWithAggregatesInput | dish_categoriesScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"dish_categories"> | string
    label_en?: StringWithAggregatesFilter<"dish_categories"> | string
    labels?: JsonWithAggregatesFilter<"dish_categories">
    image_url?: StringWithAggregatesFilter<"dish_categories"> | string
    origin?: StringNullableListFilter<"dish_categories">
    cuisine?: StringNullableListFilter<"dish_categories">
    tags?: StringNullableListFilter<"dish_categories">
    created_at?: DateTimeWithAggregatesFilter<"dish_categories"> | Date | string
    updated_at?: DateTimeWithAggregatesFilter<"dish_categories"> | Date | string
    lock_no?: IntWithAggregatesFilter<"dish_categories"> | number
  }

  export type dish_category_variantsWhereInput = {
    AND?: dish_category_variantsWhereInput | dish_category_variantsWhereInput[]
    OR?: dish_category_variantsWhereInput[]
    NOT?: dish_category_variantsWhereInput | dish_category_variantsWhereInput[]
    id?: UuidFilter<"dish_category_variants"> | string
    dish_category_id?: StringFilter<"dish_category_variants"> | string
    surface_form?: StringFilter<"dish_category_variants"> | string
    source?: StringNullableFilter<"dish_category_variants"> | string | null
    created_at?: DateTimeFilter<"dish_category_variants"> | Date | string
    dish_categories?: XOR<Dish_categoriesScalarRelationFilter, dish_categoriesWhereInput>
  }

  export type dish_category_variantsOrderByWithRelationInput = {
    id?: SortOrder
    dish_category_id?: SortOrder
    surface_form?: SortOrder
    source?: SortOrderInput | SortOrder
    created_at?: SortOrder
    dish_categories?: dish_categoriesOrderByWithRelationInput
  }

  export type dish_category_variantsWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    surface_form?: string
    AND?: dish_category_variantsWhereInput | dish_category_variantsWhereInput[]
    OR?: dish_category_variantsWhereInput[]
    NOT?: dish_category_variantsWhereInput | dish_category_variantsWhereInput[]
    dish_category_id?: StringFilter<"dish_category_variants"> | string
    source?: StringNullableFilter<"dish_category_variants"> | string | null
    created_at?: DateTimeFilter<"dish_category_variants"> | Date | string
    dish_categories?: XOR<Dish_categoriesScalarRelationFilter, dish_categoriesWhereInput>
  }, "id" | "surface_form">

  export type dish_category_variantsOrderByWithAggregationInput = {
    id?: SortOrder
    dish_category_id?: SortOrder
    surface_form?: SortOrder
    source?: SortOrderInput | SortOrder
    created_at?: SortOrder
    _count?: dish_category_variantsCountOrderByAggregateInput
    _max?: dish_category_variantsMaxOrderByAggregateInput
    _min?: dish_category_variantsMinOrderByAggregateInput
  }

  export type dish_category_variantsScalarWhereWithAggregatesInput = {
    AND?: dish_category_variantsScalarWhereWithAggregatesInput | dish_category_variantsScalarWhereWithAggregatesInput[]
    OR?: dish_category_variantsScalarWhereWithAggregatesInput[]
    NOT?: dish_category_variantsScalarWhereWithAggregatesInput | dish_category_variantsScalarWhereWithAggregatesInput[]
    id?: UuidWithAggregatesFilter<"dish_category_variants"> | string
    dish_category_id?: StringWithAggregatesFilter<"dish_category_variants"> | string
    surface_form?: StringWithAggregatesFilter<"dish_category_variants"> | string
    source?: StringNullableWithAggregatesFilter<"dish_category_variants"> | string | null
    created_at?: DateTimeWithAggregatesFilter<"dish_category_variants"> | Date | string
  }

  export type dish_likesWhereInput = {
    AND?: dish_likesWhereInput | dish_likesWhereInput[]
    OR?: dish_likesWhereInput[]
    NOT?: dish_likesWhereInput | dish_likesWhereInput[]
    id?: UuidFilter<"dish_likes"> | string
    dish_media_id?: UuidFilter<"dish_likes"> | string
    user_id?: UuidFilter<"dish_likes"> | string
    created_at?: DateTimeFilter<"dish_likes"> | Date | string
    dish_media?: XOR<Dish_mediaScalarRelationFilter, dish_mediaWhereInput>
    users?: XOR<UsersScalarRelationFilter, usersWhereInput>
  }

  export type dish_likesOrderByWithRelationInput = {
    id?: SortOrder
    dish_media_id?: SortOrder
    user_id?: SortOrder
    created_at?: SortOrder
    dish_media?: dish_mediaOrderByWithRelationInput
    users?: usersOrderByWithRelationInput
  }

  export type dish_likesWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    dish_media_id_user_id?: dish_likesDish_media_idUser_idCompoundUniqueInput
    AND?: dish_likesWhereInput | dish_likesWhereInput[]
    OR?: dish_likesWhereInput[]
    NOT?: dish_likesWhereInput | dish_likesWhereInput[]
    dish_media_id?: UuidFilter<"dish_likes"> | string
    user_id?: UuidFilter<"dish_likes"> | string
    created_at?: DateTimeFilter<"dish_likes"> | Date | string
    dish_media?: XOR<Dish_mediaScalarRelationFilter, dish_mediaWhereInput>
    users?: XOR<UsersScalarRelationFilter, usersWhereInput>
  }, "id" | "dish_media_id_user_id">

  export type dish_likesOrderByWithAggregationInput = {
    id?: SortOrder
    dish_media_id?: SortOrder
    user_id?: SortOrder
    created_at?: SortOrder
    _count?: dish_likesCountOrderByAggregateInput
    _max?: dish_likesMaxOrderByAggregateInput
    _min?: dish_likesMinOrderByAggregateInput
  }

  export type dish_likesScalarWhereWithAggregatesInput = {
    AND?: dish_likesScalarWhereWithAggregatesInput | dish_likesScalarWhereWithAggregatesInput[]
    OR?: dish_likesScalarWhereWithAggregatesInput[]
    NOT?: dish_likesScalarWhereWithAggregatesInput | dish_likesScalarWhereWithAggregatesInput[]
    id?: UuidWithAggregatesFilter<"dish_likes"> | string
    dish_media_id?: UuidWithAggregatesFilter<"dish_likes"> | string
    user_id?: UuidWithAggregatesFilter<"dish_likes"> | string
    created_at?: DateTimeWithAggregatesFilter<"dish_likes"> | Date | string
  }

  export type dish_mediaWhereInput = {
    AND?: dish_mediaWhereInput | dish_mediaWhereInput[]
    OR?: dish_mediaWhereInput[]
    NOT?: dish_mediaWhereInput | dish_mediaWhereInput[]
    id?: UuidFilter<"dish_media"> | string
    dish_id?: UuidFilter<"dish_media"> | string
    user_id?: UuidNullableFilter<"dish_media"> | string | null
    media_path?: StringFilter<"dish_media"> | string
    media_type?: StringFilter<"dish_media"> | string
    thumbnail_path?: StringNullableFilter<"dish_media"> | string | null
    created_at?: DateTimeFilter<"dish_media"> | Date | string
    updated_at?: DateTimeFilter<"dish_media"> | Date | string
    lock_no?: IntFilter<"dish_media"> | number
    dish_likes?: Dish_likesListRelationFilter
    dishes?: XOR<DishesScalarRelationFilter, dishesWhereInput>
    users?: XOR<UsersNullableScalarRelationFilter, usersWhereInput> | null
    payouts?: PayoutsListRelationFilter
  }

  export type dish_mediaOrderByWithRelationInput = {
    id?: SortOrder
    dish_id?: SortOrder
    user_id?: SortOrderInput | SortOrder
    media_path?: SortOrder
    media_type?: SortOrder
    thumbnail_path?: SortOrderInput | SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    lock_no?: SortOrder
    dish_likes?: dish_likesOrderByRelationAggregateInput
    dishes?: dishesOrderByWithRelationInput
    users?: usersOrderByWithRelationInput
    payouts?: payoutsOrderByRelationAggregateInput
  }

  export type dish_mediaWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: dish_mediaWhereInput | dish_mediaWhereInput[]
    OR?: dish_mediaWhereInput[]
    NOT?: dish_mediaWhereInput | dish_mediaWhereInput[]
    dish_id?: UuidFilter<"dish_media"> | string
    user_id?: UuidNullableFilter<"dish_media"> | string | null
    media_path?: StringFilter<"dish_media"> | string
    media_type?: StringFilter<"dish_media"> | string
    thumbnail_path?: StringNullableFilter<"dish_media"> | string | null
    created_at?: DateTimeFilter<"dish_media"> | Date | string
    updated_at?: DateTimeFilter<"dish_media"> | Date | string
    lock_no?: IntFilter<"dish_media"> | number
    dish_likes?: Dish_likesListRelationFilter
    dishes?: XOR<DishesScalarRelationFilter, dishesWhereInput>
    users?: XOR<UsersNullableScalarRelationFilter, usersWhereInput> | null
    payouts?: PayoutsListRelationFilter
  }, "id">

  export type dish_mediaOrderByWithAggregationInput = {
    id?: SortOrder
    dish_id?: SortOrder
    user_id?: SortOrderInput | SortOrder
    media_path?: SortOrder
    media_type?: SortOrder
    thumbnail_path?: SortOrderInput | SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    lock_no?: SortOrder
    _count?: dish_mediaCountOrderByAggregateInput
    _avg?: dish_mediaAvgOrderByAggregateInput
    _max?: dish_mediaMaxOrderByAggregateInput
    _min?: dish_mediaMinOrderByAggregateInput
    _sum?: dish_mediaSumOrderByAggregateInput
  }

  export type dish_mediaScalarWhereWithAggregatesInput = {
    AND?: dish_mediaScalarWhereWithAggregatesInput | dish_mediaScalarWhereWithAggregatesInput[]
    OR?: dish_mediaScalarWhereWithAggregatesInput[]
    NOT?: dish_mediaScalarWhereWithAggregatesInput | dish_mediaScalarWhereWithAggregatesInput[]
    id?: UuidWithAggregatesFilter<"dish_media"> | string
    dish_id?: UuidWithAggregatesFilter<"dish_media"> | string
    user_id?: UuidNullableWithAggregatesFilter<"dish_media"> | string | null
    media_path?: StringWithAggregatesFilter<"dish_media"> | string
    media_type?: StringWithAggregatesFilter<"dish_media"> | string
    thumbnail_path?: StringNullableWithAggregatesFilter<"dish_media"> | string | null
    created_at?: DateTimeWithAggregatesFilter<"dish_media"> | Date | string
    updated_at?: DateTimeWithAggregatesFilter<"dish_media"> | Date | string
    lock_no?: IntWithAggregatesFilter<"dish_media"> | number
  }

  export type dish_reviewsWhereInput = {
    AND?: dish_reviewsWhereInput | dish_reviewsWhereInput[]
    OR?: dish_reviewsWhereInput[]
    NOT?: dish_reviewsWhereInput | dish_reviewsWhereInput[]
    id?: UuidFilter<"dish_reviews"> | string
    dish_id?: UuidFilter<"dish_reviews"> | string
    comment?: StringFilter<"dish_reviews"> | string
    user_id?: UuidNullableFilter<"dish_reviews"> | string | null
    rating?: IntFilter<"dish_reviews"> | number
    price_cents?: IntNullableFilter<"dish_reviews"> | number | null
    currency_code?: StringNullableFilter<"dish_reviews"> | string | null
    created_dish_media_id?: UuidNullableFilter<"dish_reviews"> | string | null
    imported_user_name?: StringNullableFilter<"dish_reviews"> | string | null
    imported_user_avatar?: StringNullableFilter<"dish_reviews"> | string | null
    created_at?: DateTimeFilter<"dish_reviews"> | Date | string
    dishes?: XOR<DishesScalarRelationFilter, dishesWhereInput>
    users?: XOR<UsersNullableScalarRelationFilter, usersWhereInput> | null
  }

  export type dish_reviewsOrderByWithRelationInput = {
    id?: SortOrder
    dish_id?: SortOrder
    comment?: SortOrder
    user_id?: SortOrderInput | SortOrder
    rating?: SortOrder
    price_cents?: SortOrderInput | SortOrder
    currency_code?: SortOrderInput | SortOrder
    created_dish_media_id?: SortOrderInput | SortOrder
    imported_user_name?: SortOrderInput | SortOrder
    imported_user_avatar?: SortOrderInput | SortOrder
    created_at?: SortOrder
    dishes?: dishesOrderByWithRelationInput
    users?: usersOrderByWithRelationInput
  }

  export type dish_reviewsWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: dish_reviewsWhereInput | dish_reviewsWhereInput[]
    OR?: dish_reviewsWhereInput[]
    NOT?: dish_reviewsWhereInput | dish_reviewsWhereInput[]
    dish_id?: UuidFilter<"dish_reviews"> | string
    comment?: StringFilter<"dish_reviews"> | string
    user_id?: UuidNullableFilter<"dish_reviews"> | string | null
    rating?: IntFilter<"dish_reviews"> | number
    price_cents?: IntNullableFilter<"dish_reviews"> | number | null
    currency_code?: StringNullableFilter<"dish_reviews"> | string | null
    created_dish_media_id?: UuidNullableFilter<"dish_reviews"> | string | null
    imported_user_name?: StringNullableFilter<"dish_reviews"> | string | null
    imported_user_avatar?: StringNullableFilter<"dish_reviews"> | string | null
    created_at?: DateTimeFilter<"dish_reviews"> | Date | string
    dishes?: XOR<DishesScalarRelationFilter, dishesWhereInput>
    users?: XOR<UsersNullableScalarRelationFilter, usersWhereInput> | null
  }, "id">

  export type dish_reviewsOrderByWithAggregationInput = {
    id?: SortOrder
    dish_id?: SortOrder
    comment?: SortOrder
    user_id?: SortOrderInput | SortOrder
    rating?: SortOrder
    price_cents?: SortOrderInput | SortOrder
    currency_code?: SortOrderInput | SortOrder
    created_dish_media_id?: SortOrderInput | SortOrder
    imported_user_name?: SortOrderInput | SortOrder
    imported_user_avatar?: SortOrderInput | SortOrder
    created_at?: SortOrder
    _count?: dish_reviewsCountOrderByAggregateInput
    _avg?: dish_reviewsAvgOrderByAggregateInput
    _max?: dish_reviewsMaxOrderByAggregateInput
    _min?: dish_reviewsMinOrderByAggregateInput
    _sum?: dish_reviewsSumOrderByAggregateInput
  }

  export type dish_reviewsScalarWhereWithAggregatesInput = {
    AND?: dish_reviewsScalarWhereWithAggregatesInput | dish_reviewsScalarWhereWithAggregatesInput[]
    OR?: dish_reviewsScalarWhereWithAggregatesInput[]
    NOT?: dish_reviewsScalarWhereWithAggregatesInput | dish_reviewsScalarWhereWithAggregatesInput[]
    id?: UuidWithAggregatesFilter<"dish_reviews"> | string
    dish_id?: UuidWithAggregatesFilter<"dish_reviews"> | string
    comment?: StringWithAggregatesFilter<"dish_reviews"> | string
    user_id?: UuidNullableWithAggregatesFilter<"dish_reviews"> | string | null
    rating?: IntWithAggregatesFilter<"dish_reviews"> | number
    price_cents?: IntNullableWithAggregatesFilter<"dish_reviews"> | number | null
    currency_code?: StringNullableWithAggregatesFilter<"dish_reviews"> | string | null
    created_dish_media_id?: UuidNullableWithAggregatesFilter<"dish_reviews"> | string | null
    imported_user_name?: StringNullableWithAggregatesFilter<"dish_reviews"> | string | null
    imported_user_avatar?: StringNullableWithAggregatesFilter<"dish_reviews"> | string | null
    created_at?: DateTimeWithAggregatesFilter<"dish_reviews"> | Date | string
  }

  export type dishesWhereInput = {
    AND?: dishesWhereInput | dishesWhereInput[]
    OR?: dishesWhereInput[]
    NOT?: dishesWhereInput | dishesWhereInput[]
    id?: UuidFilter<"dishes"> | string
    restaurant_id?: UuidNullableFilter<"dishes"> | string | null
    category_id?: StringFilter<"dishes"> | string
    name?: StringNullableFilter<"dishes"> | string | null
    created_at?: DateTimeFilter<"dishes"> | Date | string
    updated_at?: DateTimeFilter<"dishes"> | Date | string
    lock_no?: IntFilter<"dishes"> | number
    dish_media?: Dish_mediaListRelationFilter
    dish_reviews?: Dish_reviewsListRelationFilter
    dish_categories?: XOR<Dish_categoriesScalarRelationFilter, dish_categoriesWhereInput>
    restaurants?: XOR<RestaurantsNullableScalarRelationFilter, restaurantsWhereInput> | null
  }

  export type dishesOrderByWithRelationInput = {
    id?: SortOrder
    restaurant_id?: SortOrderInput | SortOrder
    category_id?: SortOrder
    name?: SortOrderInput | SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    lock_no?: SortOrder
    dish_media?: dish_mediaOrderByRelationAggregateInput
    dish_reviews?: dish_reviewsOrderByRelationAggregateInput
    dish_categories?: dish_categoriesOrderByWithRelationInput
    restaurants?: restaurantsOrderByWithRelationInput
  }

  export type dishesWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: dishesWhereInput | dishesWhereInput[]
    OR?: dishesWhereInput[]
    NOT?: dishesWhereInput | dishesWhereInput[]
    restaurant_id?: UuidNullableFilter<"dishes"> | string | null
    category_id?: StringFilter<"dishes"> | string
    name?: StringNullableFilter<"dishes"> | string | null
    created_at?: DateTimeFilter<"dishes"> | Date | string
    updated_at?: DateTimeFilter<"dishes"> | Date | string
    lock_no?: IntFilter<"dishes"> | number
    dish_media?: Dish_mediaListRelationFilter
    dish_reviews?: Dish_reviewsListRelationFilter
    dish_categories?: XOR<Dish_categoriesScalarRelationFilter, dish_categoriesWhereInput>
    restaurants?: XOR<RestaurantsNullableScalarRelationFilter, restaurantsWhereInput> | null
  }, "id">

  export type dishesOrderByWithAggregationInput = {
    id?: SortOrder
    restaurant_id?: SortOrderInput | SortOrder
    category_id?: SortOrder
    name?: SortOrderInput | SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    lock_no?: SortOrder
    _count?: dishesCountOrderByAggregateInput
    _avg?: dishesAvgOrderByAggregateInput
    _max?: dishesMaxOrderByAggregateInput
    _min?: dishesMinOrderByAggregateInput
    _sum?: dishesSumOrderByAggregateInput
  }

  export type dishesScalarWhereWithAggregatesInput = {
    AND?: dishesScalarWhereWithAggregatesInput | dishesScalarWhereWithAggregatesInput[]
    OR?: dishesScalarWhereWithAggregatesInput[]
    NOT?: dishesScalarWhereWithAggregatesInput | dishesScalarWhereWithAggregatesInput[]
    id?: UuidWithAggregatesFilter<"dishes"> | string
    restaurant_id?: UuidNullableWithAggregatesFilter<"dishes"> | string | null
    category_id?: StringWithAggregatesFilter<"dishes"> | string
    name?: StringNullableWithAggregatesFilter<"dishes"> | string | null
    created_at?: DateTimeWithAggregatesFilter<"dishes"> | Date | string
    updated_at?: DateTimeWithAggregatesFilter<"dishes"> | Date | string
    lock_no?: IntWithAggregatesFilter<"dishes"> | number
  }

  export type payoutsWhereInput = {
    AND?: payoutsWhereInput | payoutsWhereInput[]
    OR?: payoutsWhereInput[]
    NOT?: payoutsWhereInput | payoutsWhereInput[]
    id?: UuidFilter<"payouts"> | string
    bid_id?: UuidFilter<"payouts"> | string
    transfer_id?: StringFilter<"payouts"> | string
    dish_media_id?: UuidFilter<"payouts"> | string
    amount_cents?: BigIntFilter<"payouts"> | bigint | number
    currency_code?: StringNullableFilter<"payouts"> | string | null
    status?: Enumpayout_statusFilter<"payouts"> | $Enums.payout_status
    created_at?: DateTimeFilter<"payouts"> | Date | string
    updated_at?: DateTimeFilter<"payouts"> | Date | string
    lock_no?: IntFilter<"payouts"> | number
    restaurant_bids?: XOR<Restaurant_bidsScalarRelationFilter, restaurant_bidsWhereInput>
    dish_media?: XOR<Dish_mediaScalarRelationFilter, dish_mediaWhereInput>
  }

  export type payoutsOrderByWithRelationInput = {
    id?: SortOrder
    bid_id?: SortOrder
    transfer_id?: SortOrder
    dish_media_id?: SortOrder
    amount_cents?: SortOrder
    currency_code?: SortOrderInput | SortOrder
    status?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    lock_no?: SortOrder
    restaurant_bids?: restaurant_bidsOrderByWithRelationInput
    dish_media?: dish_mediaOrderByWithRelationInput
  }

  export type payoutsWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    transfer_id?: string
    bid_id_dish_media_id?: payoutsBid_idDish_media_idCompoundUniqueInput
    AND?: payoutsWhereInput | payoutsWhereInput[]
    OR?: payoutsWhereInput[]
    NOT?: payoutsWhereInput | payoutsWhereInput[]
    bid_id?: UuidFilter<"payouts"> | string
    dish_media_id?: UuidFilter<"payouts"> | string
    amount_cents?: BigIntFilter<"payouts"> | bigint | number
    currency_code?: StringNullableFilter<"payouts"> | string | null
    status?: Enumpayout_statusFilter<"payouts"> | $Enums.payout_status
    created_at?: DateTimeFilter<"payouts"> | Date | string
    updated_at?: DateTimeFilter<"payouts"> | Date | string
    lock_no?: IntFilter<"payouts"> | number
    restaurant_bids?: XOR<Restaurant_bidsScalarRelationFilter, restaurant_bidsWhereInput>
    dish_media?: XOR<Dish_mediaScalarRelationFilter, dish_mediaWhereInput>
  }, "id" | "transfer_id" | "bid_id_dish_media_id">

  export type payoutsOrderByWithAggregationInput = {
    id?: SortOrder
    bid_id?: SortOrder
    transfer_id?: SortOrder
    dish_media_id?: SortOrder
    amount_cents?: SortOrder
    currency_code?: SortOrderInput | SortOrder
    status?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    lock_no?: SortOrder
    _count?: payoutsCountOrderByAggregateInput
    _avg?: payoutsAvgOrderByAggregateInput
    _max?: payoutsMaxOrderByAggregateInput
    _min?: payoutsMinOrderByAggregateInput
    _sum?: payoutsSumOrderByAggregateInput
  }

  export type payoutsScalarWhereWithAggregatesInput = {
    AND?: payoutsScalarWhereWithAggregatesInput | payoutsScalarWhereWithAggregatesInput[]
    OR?: payoutsScalarWhereWithAggregatesInput[]
    NOT?: payoutsScalarWhereWithAggregatesInput | payoutsScalarWhereWithAggregatesInput[]
    id?: UuidWithAggregatesFilter<"payouts"> | string
    bid_id?: UuidWithAggregatesFilter<"payouts"> | string
    transfer_id?: StringWithAggregatesFilter<"payouts"> | string
    dish_media_id?: UuidWithAggregatesFilter<"payouts"> | string
    amount_cents?: BigIntWithAggregatesFilter<"payouts"> | bigint | number
    currency_code?: StringNullableWithAggregatesFilter<"payouts"> | string | null
    status?: Enumpayout_statusWithAggregatesFilter<"payouts"> | $Enums.payout_status
    created_at?: DateTimeWithAggregatesFilter<"payouts"> | Date | string
    updated_at?: DateTimeWithAggregatesFilter<"payouts"> | Date | string
    lock_no?: IntWithAggregatesFilter<"payouts"> | number
  }

  export type restaurant_bidsWhereInput = {
    AND?: restaurant_bidsWhereInput | restaurant_bidsWhereInput[]
    OR?: restaurant_bidsWhereInput[]
    NOT?: restaurant_bidsWhereInput | restaurant_bidsWhereInput[]
    id?: UuidFilter<"restaurant_bids"> | string
    restaurant_id?: UuidFilter<"restaurant_bids"> | string
    user_id?: UuidFilter<"restaurant_bids"> | string
    payment_intent_id?: StringNullableFilter<"restaurant_bids"> | string | null
    amount_cents?: BigIntFilter<"restaurant_bids"> | bigint | number
    currency_code?: StringFilter<"restaurant_bids"> | string
    start_date?: DateTimeFilter<"restaurant_bids"> | Date | string
    end_date?: DateTimeFilter<"restaurant_bids"> | Date | string
    status?: Enumrestaurant_bid_statusFilter<"restaurant_bids"> | $Enums.restaurant_bid_status
    refund_id?: StringNullableFilter<"restaurant_bids"> | string | null
    created_at?: DateTimeFilter<"restaurant_bids"> | Date | string
    updated_at?: DateTimeFilter<"restaurant_bids"> | Date | string
    lock_no?: IntFilter<"restaurant_bids"> | number
    payouts?: PayoutsListRelationFilter
    restaurants?: XOR<RestaurantsScalarRelationFilter, restaurantsWhereInput>
    users?: XOR<UsersScalarRelationFilter, usersWhereInput>
  }

  export type restaurant_bidsOrderByWithRelationInput = {
    id?: SortOrder
    restaurant_id?: SortOrder
    user_id?: SortOrder
    payment_intent_id?: SortOrderInput | SortOrder
    amount_cents?: SortOrder
    currency_code?: SortOrder
    start_date?: SortOrder
    end_date?: SortOrder
    status?: SortOrder
    refund_id?: SortOrderInput | SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    lock_no?: SortOrder
    payouts?: payoutsOrderByRelationAggregateInput
    restaurants?: restaurantsOrderByWithRelationInput
    users?: usersOrderByWithRelationInput
  }

  export type restaurant_bidsWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: restaurant_bidsWhereInput | restaurant_bidsWhereInput[]
    OR?: restaurant_bidsWhereInput[]
    NOT?: restaurant_bidsWhereInput | restaurant_bidsWhereInput[]
    restaurant_id?: UuidFilter<"restaurant_bids"> | string
    user_id?: UuidFilter<"restaurant_bids"> | string
    payment_intent_id?: StringNullableFilter<"restaurant_bids"> | string | null
    amount_cents?: BigIntFilter<"restaurant_bids"> | bigint | number
    currency_code?: StringFilter<"restaurant_bids"> | string
    start_date?: DateTimeFilter<"restaurant_bids"> | Date | string
    end_date?: DateTimeFilter<"restaurant_bids"> | Date | string
    status?: Enumrestaurant_bid_statusFilter<"restaurant_bids"> | $Enums.restaurant_bid_status
    refund_id?: StringNullableFilter<"restaurant_bids"> | string | null
    created_at?: DateTimeFilter<"restaurant_bids"> | Date | string
    updated_at?: DateTimeFilter<"restaurant_bids"> | Date | string
    lock_no?: IntFilter<"restaurant_bids"> | number
    payouts?: PayoutsListRelationFilter
    restaurants?: XOR<RestaurantsScalarRelationFilter, restaurantsWhereInput>
    users?: XOR<UsersScalarRelationFilter, usersWhereInput>
  }, "id">

  export type restaurant_bidsOrderByWithAggregationInput = {
    id?: SortOrder
    restaurant_id?: SortOrder
    user_id?: SortOrder
    payment_intent_id?: SortOrderInput | SortOrder
    amount_cents?: SortOrder
    currency_code?: SortOrder
    start_date?: SortOrder
    end_date?: SortOrder
    status?: SortOrder
    refund_id?: SortOrderInput | SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    lock_no?: SortOrder
    _count?: restaurant_bidsCountOrderByAggregateInput
    _avg?: restaurant_bidsAvgOrderByAggregateInput
    _max?: restaurant_bidsMaxOrderByAggregateInput
    _min?: restaurant_bidsMinOrderByAggregateInput
    _sum?: restaurant_bidsSumOrderByAggregateInput
  }

  export type restaurant_bidsScalarWhereWithAggregatesInput = {
    AND?: restaurant_bidsScalarWhereWithAggregatesInput | restaurant_bidsScalarWhereWithAggregatesInput[]
    OR?: restaurant_bidsScalarWhereWithAggregatesInput[]
    NOT?: restaurant_bidsScalarWhereWithAggregatesInput | restaurant_bidsScalarWhereWithAggregatesInput[]
    id?: UuidWithAggregatesFilter<"restaurant_bids"> | string
    restaurant_id?: UuidWithAggregatesFilter<"restaurant_bids"> | string
    user_id?: UuidWithAggregatesFilter<"restaurant_bids"> | string
    payment_intent_id?: StringNullableWithAggregatesFilter<"restaurant_bids"> | string | null
    amount_cents?: BigIntWithAggregatesFilter<"restaurant_bids"> | bigint | number
    currency_code?: StringWithAggregatesFilter<"restaurant_bids"> | string
    start_date?: DateTimeWithAggregatesFilter<"restaurant_bids"> | Date | string
    end_date?: DateTimeWithAggregatesFilter<"restaurant_bids"> | Date | string
    status?: Enumrestaurant_bid_statusWithAggregatesFilter<"restaurant_bids"> | $Enums.restaurant_bid_status
    refund_id?: StringNullableWithAggregatesFilter<"restaurant_bids"> | string | null
    created_at?: DateTimeWithAggregatesFilter<"restaurant_bids"> | Date | string
    updated_at?: DateTimeWithAggregatesFilter<"restaurant_bids"> | Date | string
    lock_no?: IntWithAggregatesFilter<"restaurant_bids"> | number
  }

  export type restaurantsWhereInput = {
    AND?: restaurantsWhereInput | restaurantsWhereInput[]
    OR?: restaurantsWhereInput[]
    NOT?: restaurantsWhereInput | restaurantsWhereInput[]
    id?: UuidFilter<"restaurants"> | string
    google_place_id?: StringNullableFilter<"restaurants"> | string | null
    name?: StringFilter<"restaurants"> | string
    image_url?: StringNullableFilter<"restaurants"> | string | null
    created_at?: DateTimeFilter<"restaurants"> | Date | string
    dishes?: DishesListRelationFilter
    restaurant_bids?: Restaurant_bidsListRelationFilter
  }

  export type restaurantsOrderByWithRelationInput = {
    id?: SortOrder
    google_place_id?: SortOrderInput | SortOrder
    name?: SortOrder
    image_url?: SortOrderInput | SortOrder
    created_at?: SortOrder
    dishes?: dishesOrderByRelationAggregateInput
    restaurant_bids?: restaurant_bidsOrderByRelationAggregateInput
  }

  export type restaurantsWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    google_place_id?: string
    AND?: restaurantsWhereInput | restaurantsWhereInput[]
    OR?: restaurantsWhereInput[]
    NOT?: restaurantsWhereInput | restaurantsWhereInput[]
    name?: StringFilter<"restaurants"> | string
    image_url?: StringNullableFilter<"restaurants"> | string | null
    created_at?: DateTimeFilter<"restaurants"> | Date | string
    dishes?: DishesListRelationFilter
    restaurant_bids?: Restaurant_bidsListRelationFilter
  }, "id" | "google_place_id">

  export type restaurantsOrderByWithAggregationInput = {
    id?: SortOrder
    google_place_id?: SortOrderInput | SortOrder
    name?: SortOrder
    image_url?: SortOrderInput | SortOrder
    created_at?: SortOrder
    _count?: restaurantsCountOrderByAggregateInput
    _max?: restaurantsMaxOrderByAggregateInput
    _min?: restaurantsMinOrderByAggregateInput
  }

  export type restaurantsScalarWhereWithAggregatesInput = {
    AND?: restaurantsScalarWhereWithAggregatesInput | restaurantsScalarWhereWithAggregatesInput[]
    OR?: restaurantsScalarWhereWithAggregatesInput[]
    NOT?: restaurantsScalarWhereWithAggregatesInput | restaurantsScalarWhereWithAggregatesInput[]
    id?: UuidWithAggregatesFilter<"restaurants"> | string
    google_place_id?: StringNullableWithAggregatesFilter<"restaurants"> | string | null
    name?: StringWithAggregatesFilter<"restaurants"> | string
    image_url?: StringNullableWithAggregatesFilter<"restaurants"> | string | null
    created_at?: DateTimeWithAggregatesFilter<"restaurants"> | Date | string
  }

  export type spatial_ref_sysWhereInput = {
    AND?: spatial_ref_sysWhereInput | spatial_ref_sysWhereInput[]
    OR?: spatial_ref_sysWhereInput[]
    NOT?: spatial_ref_sysWhereInput | spatial_ref_sysWhereInput[]
    srid?: IntFilter<"spatial_ref_sys"> | number
    auth_name?: StringNullableFilter<"spatial_ref_sys"> | string | null
    auth_srid?: IntNullableFilter<"spatial_ref_sys"> | number | null
    srtext?: StringNullableFilter<"spatial_ref_sys"> | string | null
    proj4text?: StringNullableFilter<"spatial_ref_sys"> | string | null
  }

  export type spatial_ref_sysOrderByWithRelationInput = {
    srid?: SortOrder
    auth_name?: SortOrderInput | SortOrder
    auth_srid?: SortOrderInput | SortOrder
    srtext?: SortOrderInput | SortOrder
    proj4text?: SortOrderInput | SortOrder
  }

  export type spatial_ref_sysWhereUniqueInput = Prisma.AtLeast<{
    srid?: number
    AND?: spatial_ref_sysWhereInput | spatial_ref_sysWhereInput[]
    OR?: spatial_ref_sysWhereInput[]
    NOT?: spatial_ref_sysWhereInput | spatial_ref_sysWhereInput[]
    auth_name?: StringNullableFilter<"spatial_ref_sys"> | string | null
    auth_srid?: IntNullableFilter<"spatial_ref_sys"> | number | null
    srtext?: StringNullableFilter<"spatial_ref_sys"> | string | null
    proj4text?: StringNullableFilter<"spatial_ref_sys"> | string | null
  }, "srid">

  export type spatial_ref_sysOrderByWithAggregationInput = {
    srid?: SortOrder
    auth_name?: SortOrderInput | SortOrder
    auth_srid?: SortOrderInput | SortOrder
    srtext?: SortOrderInput | SortOrder
    proj4text?: SortOrderInput | SortOrder
    _count?: spatial_ref_sysCountOrderByAggregateInput
    _avg?: spatial_ref_sysAvgOrderByAggregateInput
    _max?: spatial_ref_sysMaxOrderByAggregateInput
    _min?: spatial_ref_sysMinOrderByAggregateInput
    _sum?: spatial_ref_sysSumOrderByAggregateInput
  }

  export type spatial_ref_sysScalarWhereWithAggregatesInput = {
    AND?: spatial_ref_sysScalarWhereWithAggregatesInput | spatial_ref_sysScalarWhereWithAggregatesInput[]
    OR?: spatial_ref_sysScalarWhereWithAggregatesInput[]
    NOT?: spatial_ref_sysScalarWhereWithAggregatesInput | spatial_ref_sysScalarWhereWithAggregatesInput[]
    srid?: IntWithAggregatesFilter<"spatial_ref_sys"> | number
    auth_name?: StringNullableWithAggregatesFilter<"spatial_ref_sys"> | string | null
    auth_srid?: IntNullableWithAggregatesFilter<"spatial_ref_sys"> | number | null
    srtext?: StringNullableWithAggregatesFilter<"spatial_ref_sys"> | string | null
    proj4text?: StringNullableWithAggregatesFilter<"spatial_ref_sys"> | string | null
  }

  export type usersWhereInput = {
    AND?: usersWhereInput | usersWhereInput[]
    OR?: usersWhereInput[]
    NOT?: usersWhereInput | usersWhereInput[]
    id?: UuidFilter<"users"> | string
    username?: StringFilter<"users"> | string
    display_name?: StringNullableFilter<"users"> | string | null
    avatar?: StringNullableFilter<"users"> | string | null
    bio?: StringNullableFilter<"users"> | string | null
    last_login_at?: DateTimeNullableFilter<"users"> | Date | string | null
    created_at?: DateTimeFilter<"users"> | Date | string
    updated_at?: DateTimeFilter<"users"> | Date | string
    lock_no?: IntFilter<"users"> | number
    dish_likes?: Dish_likesListRelationFilter
    dish_media?: Dish_mediaListRelationFilter
    dish_reviews?: Dish_reviewsListRelationFilter
    restaurant_bids?: Restaurant_bidsListRelationFilter
  }

  export type usersOrderByWithRelationInput = {
    id?: SortOrder
    username?: SortOrder
    display_name?: SortOrderInput | SortOrder
    avatar?: SortOrderInput | SortOrder
    bio?: SortOrderInput | SortOrder
    last_login_at?: SortOrderInput | SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    lock_no?: SortOrder
    dish_likes?: dish_likesOrderByRelationAggregateInput
    dish_media?: dish_mediaOrderByRelationAggregateInput
    dish_reviews?: dish_reviewsOrderByRelationAggregateInput
    restaurant_bids?: restaurant_bidsOrderByRelationAggregateInput
  }

  export type usersWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    username?: string
    AND?: usersWhereInput | usersWhereInput[]
    OR?: usersWhereInput[]
    NOT?: usersWhereInput | usersWhereInput[]
    display_name?: StringNullableFilter<"users"> | string | null
    avatar?: StringNullableFilter<"users"> | string | null
    bio?: StringNullableFilter<"users"> | string | null
    last_login_at?: DateTimeNullableFilter<"users"> | Date | string | null
    created_at?: DateTimeFilter<"users"> | Date | string
    updated_at?: DateTimeFilter<"users"> | Date | string
    lock_no?: IntFilter<"users"> | number
    dish_likes?: Dish_likesListRelationFilter
    dish_media?: Dish_mediaListRelationFilter
    dish_reviews?: Dish_reviewsListRelationFilter
    restaurant_bids?: Restaurant_bidsListRelationFilter
  }, "id" | "username">

  export type usersOrderByWithAggregationInput = {
    id?: SortOrder
    username?: SortOrder
    display_name?: SortOrderInput | SortOrder
    avatar?: SortOrderInput | SortOrder
    bio?: SortOrderInput | SortOrder
    last_login_at?: SortOrderInput | SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    lock_no?: SortOrder
    _count?: usersCountOrderByAggregateInput
    _avg?: usersAvgOrderByAggregateInput
    _max?: usersMaxOrderByAggregateInput
    _min?: usersMinOrderByAggregateInput
    _sum?: usersSumOrderByAggregateInput
  }

  export type usersScalarWhereWithAggregatesInput = {
    AND?: usersScalarWhereWithAggregatesInput | usersScalarWhereWithAggregatesInput[]
    OR?: usersScalarWhereWithAggregatesInput[]
    NOT?: usersScalarWhereWithAggregatesInput | usersScalarWhereWithAggregatesInput[]
    id?: UuidWithAggregatesFilter<"users"> | string
    username?: StringWithAggregatesFilter<"users"> | string
    display_name?: StringNullableWithAggregatesFilter<"users"> | string | null
    avatar?: StringNullableWithAggregatesFilter<"users"> | string | null
    bio?: StringNullableWithAggregatesFilter<"users"> | string | null
    last_login_at?: DateTimeNullableWithAggregatesFilter<"users"> | Date | string | null
    created_at?: DateTimeWithAggregatesFilter<"users"> | Date | string
    updated_at?: DateTimeWithAggregatesFilter<"users"> | Date | string
    lock_no?: IntWithAggregatesFilter<"users"> | number
  }

  export type dish_categoriesCreateInput = {
    id: string
    label_en: string
    labels: JsonNullValueInput | InputJsonValue
    image_url: string
    origin?: dish_categoriesCreateoriginInput | string[]
    cuisine?: dish_categoriesCreatecuisineInput | string[]
    tags?: dish_categoriesCreatetagsInput | string[]
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    dish_category_variants?: dish_category_variantsCreateNestedManyWithoutDish_categoriesInput
    dishes?: dishesCreateNestedManyWithoutDish_categoriesInput
  }

  export type dish_categoriesUncheckedCreateInput = {
    id: string
    label_en: string
    labels: JsonNullValueInput | InputJsonValue
    image_url: string
    origin?: dish_categoriesCreateoriginInput | string[]
    cuisine?: dish_categoriesCreatecuisineInput | string[]
    tags?: dish_categoriesCreatetagsInput | string[]
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    dish_category_variants?: dish_category_variantsUncheckedCreateNestedManyWithoutDish_categoriesInput
    dishes?: dishesUncheckedCreateNestedManyWithoutDish_categoriesInput
  }

  export type dish_categoriesUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    label_en?: StringFieldUpdateOperationsInput | string
    labels?: JsonNullValueInput | InputJsonValue
    image_url?: StringFieldUpdateOperationsInput | string
    origin?: dish_categoriesUpdateoriginInput | string[]
    cuisine?: dish_categoriesUpdatecuisineInput | string[]
    tags?: dish_categoriesUpdatetagsInput | string[]
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    dish_category_variants?: dish_category_variantsUpdateManyWithoutDish_categoriesNestedInput
    dishes?: dishesUpdateManyWithoutDish_categoriesNestedInput
  }

  export type dish_categoriesUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    label_en?: StringFieldUpdateOperationsInput | string
    labels?: JsonNullValueInput | InputJsonValue
    image_url?: StringFieldUpdateOperationsInput | string
    origin?: dish_categoriesUpdateoriginInput | string[]
    cuisine?: dish_categoriesUpdatecuisineInput | string[]
    tags?: dish_categoriesUpdatetagsInput | string[]
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    dish_category_variants?: dish_category_variantsUncheckedUpdateManyWithoutDish_categoriesNestedInput
    dishes?: dishesUncheckedUpdateManyWithoutDish_categoriesNestedInput
  }

  export type dish_categoriesCreateManyInput = {
    id: string
    label_en: string
    labels: JsonNullValueInput | InputJsonValue
    image_url: string
    origin?: dish_categoriesCreateoriginInput | string[]
    cuisine?: dish_categoriesCreatecuisineInput | string[]
    tags?: dish_categoriesCreatetagsInput | string[]
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
  }

  export type dish_categoriesUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    label_en?: StringFieldUpdateOperationsInput | string
    labels?: JsonNullValueInput | InputJsonValue
    image_url?: StringFieldUpdateOperationsInput | string
    origin?: dish_categoriesUpdateoriginInput | string[]
    cuisine?: dish_categoriesUpdatecuisineInput | string[]
    tags?: dish_categoriesUpdatetagsInput | string[]
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
  }

  export type dish_categoriesUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    label_en?: StringFieldUpdateOperationsInput | string
    labels?: JsonNullValueInput | InputJsonValue
    image_url?: StringFieldUpdateOperationsInput | string
    origin?: dish_categoriesUpdateoriginInput | string[]
    cuisine?: dish_categoriesUpdatecuisineInput | string[]
    tags?: dish_categoriesUpdatetagsInput | string[]
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
  }

  export type dish_category_variantsCreateInput = {
    id?: string
    surface_form: string
    source?: string | null
    created_at?: Date | string
    dish_categories: dish_categoriesCreateNestedOneWithoutDish_category_variantsInput
  }

  export type dish_category_variantsUncheckedCreateInput = {
    id?: string
    dish_category_id: string
    surface_form: string
    source?: string | null
    created_at?: Date | string
  }

  export type dish_category_variantsUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    surface_form?: StringFieldUpdateOperationsInput | string
    source?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    dish_categories?: dish_categoriesUpdateOneRequiredWithoutDish_category_variantsNestedInput
  }

  export type dish_category_variantsUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    dish_category_id?: StringFieldUpdateOperationsInput | string
    surface_form?: StringFieldUpdateOperationsInput | string
    source?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type dish_category_variantsCreateManyInput = {
    id?: string
    dish_category_id: string
    surface_form: string
    source?: string | null
    created_at?: Date | string
  }

  export type dish_category_variantsUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    surface_form?: StringFieldUpdateOperationsInput | string
    source?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type dish_category_variantsUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    dish_category_id?: StringFieldUpdateOperationsInput | string
    surface_form?: StringFieldUpdateOperationsInput | string
    source?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type dish_likesCreateInput = {
    id?: string
    created_at?: Date | string
    dish_media: dish_mediaCreateNestedOneWithoutDish_likesInput
    users: usersCreateNestedOneWithoutDish_likesInput
  }

  export type dish_likesUncheckedCreateInput = {
    id?: string
    dish_media_id: string
    user_id: string
    created_at?: Date | string
  }

  export type dish_likesUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    dish_media?: dish_mediaUpdateOneRequiredWithoutDish_likesNestedInput
    users?: usersUpdateOneRequiredWithoutDish_likesNestedInput
  }

  export type dish_likesUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    dish_media_id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type dish_likesCreateManyInput = {
    id?: string
    dish_media_id: string
    user_id: string
    created_at?: Date | string
  }

  export type dish_likesUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type dish_likesUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    dish_media_id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type dish_mediaCreateInput = {
    id?: string
    media_path: string
    media_type: string
    thumbnail_path?: string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    dish_likes?: dish_likesCreateNestedManyWithoutDish_mediaInput
    dishes: dishesCreateNestedOneWithoutDish_mediaInput
    users?: usersCreateNestedOneWithoutDish_mediaInput
    payouts?: payoutsCreateNestedManyWithoutDish_mediaInput
  }

  export type dish_mediaUncheckedCreateInput = {
    id?: string
    dish_id: string
    user_id?: string | null
    media_path: string
    media_type: string
    thumbnail_path?: string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    dish_likes?: dish_likesUncheckedCreateNestedManyWithoutDish_mediaInput
    payouts?: payoutsUncheckedCreateNestedManyWithoutDish_mediaInput
  }

  export type dish_mediaUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    media_path?: StringFieldUpdateOperationsInput | string
    media_type?: StringFieldUpdateOperationsInput | string
    thumbnail_path?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    dish_likes?: dish_likesUpdateManyWithoutDish_mediaNestedInput
    dishes?: dishesUpdateOneRequiredWithoutDish_mediaNestedInput
    users?: usersUpdateOneWithoutDish_mediaNestedInput
    payouts?: payoutsUpdateManyWithoutDish_mediaNestedInput
  }

  export type dish_mediaUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    dish_id?: StringFieldUpdateOperationsInput | string
    user_id?: NullableStringFieldUpdateOperationsInput | string | null
    media_path?: StringFieldUpdateOperationsInput | string
    media_type?: StringFieldUpdateOperationsInput | string
    thumbnail_path?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    dish_likes?: dish_likesUncheckedUpdateManyWithoutDish_mediaNestedInput
    payouts?: payoutsUncheckedUpdateManyWithoutDish_mediaNestedInput
  }

  export type dish_mediaCreateManyInput = {
    id?: string
    dish_id: string
    user_id?: string | null
    media_path: string
    media_type: string
    thumbnail_path?: string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
  }

  export type dish_mediaUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    media_path?: StringFieldUpdateOperationsInput | string
    media_type?: StringFieldUpdateOperationsInput | string
    thumbnail_path?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
  }

  export type dish_mediaUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    dish_id?: StringFieldUpdateOperationsInput | string
    user_id?: NullableStringFieldUpdateOperationsInput | string | null
    media_path?: StringFieldUpdateOperationsInput | string
    media_type?: StringFieldUpdateOperationsInput | string
    thumbnail_path?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
  }

  export type dish_reviewsCreateInput = {
    id?: string
    comment: string
    rating: number
    price_cents?: number | null
    currency_code?: string | null
    created_dish_media_id?: string | null
    imported_user_name?: string | null
    imported_user_avatar?: string | null
    created_at?: Date | string
    dishes: dishesCreateNestedOneWithoutDish_reviewsInput
    users?: usersCreateNestedOneWithoutDish_reviewsInput
  }

  export type dish_reviewsUncheckedCreateInput = {
    id?: string
    dish_id: string
    comment: string
    user_id?: string | null
    rating: number
    price_cents?: number | null
    currency_code?: string | null
    created_dish_media_id?: string | null
    imported_user_name?: string | null
    imported_user_avatar?: string | null
    created_at?: Date | string
  }

  export type dish_reviewsUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    comment?: StringFieldUpdateOperationsInput | string
    rating?: IntFieldUpdateOperationsInput | number
    price_cents?: NullableIntFieldUpdateOperationsInput | number | null
    currency_code?: NullableStringFieldUpdateOperationsInput | string | null
    created_dish_media_id?: NullableStringFieldUpdateOperationsInput | string | null
    imported_user_name?: NullableStringFieldUpdateOperationsInput | string | null
    imported_user_avatar?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    dishes?: dishesUpdateOneRequiredWithoutDish_reviewsNestedInput
    users?: usersUpdateOneWithoutDish_reviewsNestedInput
  }

  export type dish_reviewsUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    dish_id?: StringFieldUpdateOperationsInput | string
    comment?: StringFieldUpdateOperationsInput | string
    user_id?: NullableStringFieldUpdateOperationsInput | string | null
    rating?: IntFieldUpdateOperationsInput | number
    price_cents?: NullableIntFieldUpdateOperationsInput | number | null
    currency_code?: NullableStringFieldUpdateOperationsInput | string | null
    created_dish_media_id?: NullableStringFieldUpdateOperationsInput | string | null
    imported_user_name?: NullableStringFieldUpdateOperationsInput | string | null
    imported_user_avatar?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type dish_reviewsCreateManyInput = {
    id?: string
    dish_id: string
    comment: string
    user_id?: string | null
    rating: number
    price_cents?: number | null
    currency_code?: string | null
    created_dish_media_id?: string | null
    imported_user_name?: string | null
    imported_user_avatar?: string | null
    created_at?: Date | string
  }

  export type dish_reviewsUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    comment?: StringFieldUpdateOperationsInput | string
    rating?: IntFieldUpdateOperationsInput | number
    price_cents?: NullableIntFieldUpdateOperationsInput | number | null
    currency_code?: NullableStringFieldUpdateOperationsInput | string | null
    created_dish_media_id?: NullableStringFieldUpdateOperationsInput | string | null
    imported_user_name?: NullableStringFieldUpdateOperationsInput | string | null
    imported_user_avatar?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type dish_reviewsUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    dish_id?: StringFieldUpdateOperationsInput | string
    comment?: StringFieldUpdateOperationsInput | string
    user_id?: NullableStringFieldUpdateOperationsInput | string | null
    rating?: IntFieldUpdateOperationsInput | number
    price_cents?: NullableIntFieldUpdateOperationsInput | number | null
    currency_code?: NullableStringFieldUpdateOperationsInput | string | null
    created_dish_media_id?: NullableStringFieldUpdateOperationsInput | string | null
    imported_user_name?: NullableStringFieldUpdateOperationsInput | string | null
    imported_user_avatar?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type dishesCreateInput = {
    id?: string
    name?: string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    dish_media?: dish_mediaCreateNestedManyWithoutDishesInput
    dish_reviews?: dish_reviewsCreateNestedManyWithoutDishesInput
    dish_categories: dish_categoriesCreateNestedOneWithoutDishesInput
    restaurants?: restaurantsCreateNestedOneWithoutDishesInput
  }

  export type dishesUncheckedCreateInput = {
    id?: string
    restaurant_id?: string | null
    category_id: string
    name?: string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    dish_media?: dish_mediaUncheckedCreateNestedManyWithoutDishesInput
    dish_reviews?: dish_reviewsUncheckedCreateNestedManyWithoutDishesInput
  }

  export type dishesUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    dish_media?: dish_mediaUpdateManyWithoutDishesNestedInput
    dish_reviews?: dish_reviewsUpdateManyWithoutDishesNestedInput
    dish_categories?: dish_categoriesUpdateOneRequiredWithoutDishesNestedInput
    restaurants?: restaurantsUpdateOneWithoutDishesNestedInput
  }

  export type dishesUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    restaurant_id?: NullableStringFieldUpdateOperationsInput | string | null
    category_id?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    dish_media?: dish_mediaUncheckedUpdateManyWithoutDishesNestedInput
    dish_reviews?: dish_reviewsUncheckedUpdateManyWithoutDishesNestedInput
  }

  export type dishesCreateManyInput = {
    id?: string
    restaurant_id?: string | null
    category_id: string
    name?: string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
  }

  export type dishesUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
  }

  export type dishesUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    restaurant_id?: NullableStringFieldUpdateOperationsInput | string | null
    category_id?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
  }

  export type payoutsCreateInput = {
    id?: string
    transfer_id: string
    amount_cents: bigint | number
    currency_code?: string | null
    status: $Enums.payout_status
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    restaurant_bids: restaurant_bidsCreateNestedOneWithoutPayoutsInput
    dish_media: dish_mediaCreateNestedOneWithoutPayoutsInput
  }

  export type payoutsUncheckedCreateInput = {
    id?: string
    bid_id: string
    transfer_id: string
    dish_media_id: string
    amount_cents: bigint | number
    currency_code?: string | null
    status: $Enums.payout_status
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
  }

  export type payoutsUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    transfer_id?: StringFieldUpdateOperationsInput | string
    amount_cents?: BigIntFieldUpdateOperationsInput | bigint | number
    currency_code?: NullableStringFieldUpdateOperationsInput | string | null
    status?: Enumpayout_statusFieldUpdateOperationsInput | $Enums.payout_status
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    restaurant_bids?: restaurant_bidsUpdateOneRequiredWithoutPayoutsNestedInput
    dish_media?: dish_mediaUpdateOneRequiredWithoutPayoutsNestedInput
  }

  export type payoutsUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    bid_id?: StringFieldUpdateOperationsInput | string
    transfer_id?: StringFieldUpdateOperationsInput | string
    dish_media_id?: StringFieldUpdateOperationsInput | string
    amount_cents?: BigIntFieldUpdateOperationsInput | bigint | number
    currency_code?: NullableStringFieldUpdateOperationsInput | string | null
    status?: Enumpayout_statusFieldUpdateOperationsInput | $Enums.payout_status
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
  }

  export type payoutsCreateManyInput = {
    id?: string
    bid_id: string
    transfer_id: string
    dish_media_id: string
    amount_cents: bigint | number
    currency_code?: string | null
    status: $Enums.payout_status
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
  }

  export type payoutsUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    transfer_id?: StringFieldUpdateOperationsInput | string
    amount_cents?: BigIntFieldUpdateOperationsInput | bigint | number
    currency_code?: NullableStringFieldUpdateOperationsInput | string | null
    status?: Enumpayout_statusFieldUpdateOperationsInput | $Enums.payout_status
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
  }

  export type payoutsUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    bid_id?: StringFieldUpdateOperationsInput | string
    transfer_id?: StringFieldUpdateOperationsInput | string
    dish_media_id?: StringFieldUpdateOperationsInput | string
    amount_cents?: BigIntFieldUpdateOperationsInput | bigint | number
    currency_code?: NullableStringFieldUpdateOperationsInput | string | null
    status?: Enumpayout_statusFieldUpdateOperationsInput | $Enums.payout_status
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
  }

  export type restaurant_bidsCreateInput = {
    id?: string
    payment_intent_id?: string | null
    amount_cents: bigint | number
    currency_code: string
    start_date: Date | string
    end_date: Date | string
    status: $Enums.restaurant_bid_status
    refund_id?: string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    payouts?: payoutsCreateNestedManyWithoutRestaurant_bidsInput
    restaurants: restaurantsCreateNestedOneWithoutRestaurant_bidsInput
    users: usersCreateNestedOneWithoutRestaurant_bidsInput
  }

  export type restaurant_bidsUncheckedCreateInput = {
    id?: string
    restaurant_id: string
    user_id: string
    payment_intent_id?: string | null
    amount_cents: bigint | number
    currency_code: string
    start_date: Date | string
    end_date: Date | string
    status: $Enums.restaurant_bid_status
    refund_id?: string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    payouts?: payoutsUncheckedCreateNestedManyWithoutRestaurant_bidsInput
  }

  export type restaurant_bidsUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    payment_intent_id?: NullableStringFieldUpdateOperationsInput | string | null
    amount_cents?: BigIntFieldUpdateOperationsInput | bigint | number
    currency_code?: StringFieldUpdateOperationsInput | string
    start_date?: DateTimeFieldUpdateOperationsInput | Date | string
    end_date?: DateTimeFieldUpdateOperationsInput | Date | string
    status?: Enumrestaurant_bid_statusFieldUpdateOperationsInput | $Enums.restaurant_bid_status
    refund_id?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    payouts?: payoutsUpdateManyWithoutRestaurant_bidsNestedInput
    restaurants?: restaurantsUpdateOneRequiredWithoutRestaurant_bidsNestedInput
    users?: usersUpdateOneRequiredWithoutRestaurant_bidsNestedInput
  }

  export type restaurant_bidsUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    restaurant_id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    payment_intent_id?: NullableStringFieldUpdateOperationsInput | string | null
    amount_cents?: BigIntFieldUpdateOperationsInput | bigint | number
    currency_code?: StringFieldUpdateOperationsInput | string
    start_date?: DateTimeFieldUpdateOperationsInput | Date | string
    end_date?: DateTimeFieldUpdateOperationsInput | Date | string
    status?: Enumrestaurant_bid_statusFieldUpdateOperationsInput | $Enums.restaurant_bid_status
    refund_id?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    payouts?: payoutsUncheckedUpdateManyWithoutRestaurant_bidsNestedInput
  }

  export type restaurant_bidsCreateManyInput = {
    id?: string
    restaurant_id: string
    user_id: string
    payment_intent_id?: string | null
    amount_cents: bigint | number
    currency_code: string
    start_date: Date | string
    end_date: Date | string
    status: $Enums.restaurant_bid_status
    refund_id?: string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
  }

  export type restaurant_bidsUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    payment_intent_id?: NullableStringFieldUpdateOperationsInput | string | null
    amount_cents?: BigIntFieldUpdateOperationsInput | bigint | number
    currency_code?: StringFieldUpdateOperationsInput | string
    start_date?: DateTimeFieldUpdateOperationsInput | Date | string
    end_date?: DateTimeFieldUpdateOperationsInput | Date | string
    status?: Enumrestaurant_bid_statusFieldUpdateOperationsInput | $Enums.restaurant_bid_status
    refund_id?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
  }

  export type restaurant_bidsUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    restaurant_id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    payment_intent_id?: NullableStringFieldUpdateOperationsInput | string | null
    amount_cents?: BigIntFieldUpdateOperationsInput | bigint | number
    currency_code?: StringFieldUpdateOperationsInput | string
    start_date?: DateTimeFieldUpdateOperationsInput | Date | string
    end_date?: DateTimeFieldUpdateOperationsInput | Date | string
    status?: Enumrestaurant_bid_statusFieldUpdateOperationsInput | $Enums.restaurant_bid_status
    refund_id?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
  }

  export type restaurantsUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    google_place_id?: NullableStringFieldUpdateOperationsInput | string | null
    name?: StringFieldUpdateOperationsInput | string
    image_url?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    dishes?: dishesUpdateManyWithoutRestaurantsNestedInput
    restaurant_bids?: restaurant_bidsUpdateManyWithoutRestaurantsNestedInput
  }

  export type restaurantsUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    google_place_id?: NullableStringFieldUpdateOperationsInput | string | null
    name?: StringFieldUpdateOperationsInput | string
    image_url?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    dishes?: dishesUncheckedUpdateManyWithoutRestaurantsNestedInput
    restaurant_bids?: restaurant_bidsUncheckedUpdateManyWithoutRestaurantsNestedInput
  }

  export type restaurantsUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    google_place_id?: NullableStringFieldUpdateOperationsInput | string | null
    name?: StringFieldUpdateOperationsInput | string
    image_url?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type restaurantsUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    google_place_id?: NullableStringFieldUpdateOperationsInput | string | null
    name?: StringFieldUpdateOperationsInput | string
    image_url?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type spatial_ref_sysCreateInput = {
    srid: number
    auth_name?: string | null
    auth_srid?: number | null
    srtext?: string | null
    proj4text?: string | null
  }

  export type spatial_ref_sysUncheckedCreateInput = {
    srid: number
    auth_name?: string | null
    auth_srid?: number | null
    srtext?: string | null
    proj4text?: string | null
  }

  export type spatial_ref_sysUpdateInput = {
    srid?: IntFieldUpdateOperationsInput | number
    auth_name?: NullableStringFieldUpdateOperationsInput | string | null
    auth_srid?: NullableIntFieldUpdateOperationsInput | number | null
    srtext?: NullableStringFieldUpdateOperationsInput | string | null
    proj4text?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type spatial_ref_sysUncheckedUpdateInput = {
    srid?: IntFieldUpdateOperationsInput | number
    auth_name?: NullableStringFieldUpdateOperationsInput | string | null
    auth_srid?: NullableIntFieldUpdateOperationsInput | number | null
    srtext?: NullableStringFieldUpdateOperationsInput | string | null
    proj4text?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type spatial_ref_sysCreateManyInput = {
    srid: number
    auth_name?: string | null
    auth_srid?: number | null
    srtext?: string | null
    proj4text?: string | null
  }

  export type spatial_ref_sysUpdateManyMutationInput = {
    srid?: IntFieldUpdateOperationsInput | number
    auth_name?: NullableStringFieldUpdateOperationsInput | string | null
    auth_srid?: NullableIntFieldUpdateOperationsInput | number | null
    srtext?: NullableStringFieldUpdateOperationsInput | string | null
    proj4text?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type spatial_ref_sysUncheckedUpdateManyInput = {
    srid?: IntFieldUpdateOperationsInput | number
    auth_name?: NullableStringFieldUpdateOperationsInput | string | null
    auth_srid?: NullableIntFieldUpdateOperationsInput | number | null
    srtext?: NullableStringFieldUpdateOperationsInput | string | null
    proj4text?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type usersCreateInput = {
    id?: string
    username: string
    display_name?: string | null
    avatar?: string | null
    bio?: string | null
    last_login_at?: Date | string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    dish_likes?: dish_likesCreateNestedManyWithoutUsersInput
    dish_media?: dish_mediaCreateNestedManyWithoutUsersInput
    dish_reviews?: dish_reviewsCreateNestedManyWithoutUsersInput
    restaurant_bids?: restaurant_bidsCreateNestedManyWithoutUsersInput
  }

  export type usersUncheckedCreateInput = {
    id?: string
    username: string
    display_name?: string | null
    avatar?: string | null
    bio?: string | null
    last_login_at?: Date | string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    dish_likes?: dish_likesUncheckedCreateNestedManyWithoutUsersInput
    dish_media?: dish_mediaUncheckedCreateNestedManyWithoutUsersInput
    dish_reviews?: dish_reviewsUncheckedCreateNestedManyWithoutUsersInput
    restaurant_bids?: restaurant_bidsUncheckedCreateNestedManyWithoutUsersInput
  }

  export type usersUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    username?: StringFieldUpdateOperationsInput | string
    display_name?: NullableStringFieldUpdateOperationsInput | string | null
    avatar?: NullableStringFieldUpdateOperationsInput | string | null
    bio?: NullableStringFieldUpdateOperationsInput | string | null
    last_login_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    dish_likes?: dish_likesUpdateManyWithoutUsersNestedInput
    dish_media?: dish_mediaUpdateManyWithoutUsersNestedInput
    dish_reviews?: dish_reviewsUpdateManyWithoutUsersNestedInput
    restaurant_bids?: restaurant_bidsUpdateManyWithoutUsersNestedInput
  }

  export type usersUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    username?: StringFieldUpdateOperationsInput | string
    display_name?: NullableStringFieldUpdateOperationsInput | string | null
    avatar?: NullableStringFieldUpdateOperationsInput | string | null
    bio?: NullableStringFieldUpdateOperationsInput | string | null
    last_login_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    dish_likes?: dish_likesUncheckedUpdateManyWithoutUsersNestedInput
    dish_media?: dish_mediaUncheckedUpdateManyWithoutUsersNestedInput
    dish_reviews?: dish_reviewsUncheckedUpdateManyWithoutUsersNestedInput
    restaurant_bids?: restaurant_bidsUncheckedUpdateManyWithoutUsersNestedInput
  }

  export type usersCreateManyInput = {
    id?: string
    username: string
    display_name?: string | null
    avatar?: string | null
    bio?: string | null
    last_login_at?: Date | string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
  }

  export type usersUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    username?: StringFieldUpdateOperationsInput | string
    display_name?: NullableStringFieldUpdateOperationsInput | string | null
    avatar?: NullableStringFieldUpdateOperationsInput | string | null
    bio?: NullableStringFieldUpdateOperationsInput | string | null
    last_login_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
  }

  export type usersUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    username?: StringFieldUpdateOperationsInput | string
    display_name?: NullableStringFieldUpdateOperationsInput | string | null
    avatar?: NullableStringFieldUpdateOperationsInput | string | null
    bio?: NullableStringFieldUpdateOperationsInput | string | null
    last_login_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
  }

  export type StringFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringFilter<$PrismaModel> | string
  }
  export type JsonFilter<$PrismaModel = never> =
    | PatchUndefined<
        Either<Required<JsonFilterBase<$PrismaModel>>, Exclude<keyof Required<JsonFilterBase<$PrismaModel>>, 'path'>>,
        Required<JsonFilterBase<$PrismaModel>>
      >
    | OptionalFlat<Omit<Required<JsonFilterBase<$PrismaModel>>, 'path'>>

  export type JsonFilterBase<$PrismaModel = never> = {
    equals?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    path?: string[]
    mode?: QueryMode | EnumQueryModeFieldRefInput<$PrismaModel>
    string_contains?: string | StringFieldRefInput<$PrismaModel>
    string_starts_with?: string | StringFieldRefInput<$PrismaModel>
    string_ends_with?: string | StringFieldRefInput<$PrismaModel>
    array_starts_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_ends_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_contains?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    lt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    lte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    not?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
  }

  export type StringNullableListFilter<$PrismaModel = never> = {
    equals?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    has?: string | StringFieldRefInput<$PrismaModel> | null
    hasEvery?: string[] | ListStringFieldRefInput<$PrismaModel>
    hasSome?: string[] | ListStringFieldRefInput<$PrismaModel>
    isEmpty?: boolean
  }

  export type DateTimeFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeFilter<$PrismaModel> | Date | string
  }

  export type IntFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntFilter<$PrismaModel> | number
  }

  export type Dish_category_variantsListRelationFilter = {
    every?: dish_category_variantsWhereInput
    some?: dish_category_variantsWhereInput
    none?: dish_category_variantsWhereInput
  }

  export type DishesListRelationFilter = {
    every?: dishesWhereInput
    some?: dishesWhereInput
    none?: dishesWhereInput
  }

  export type dish_category_variantsOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type dishesOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type dish_categoriesCountOrderByAggregateInput = {
    id?: SortOrder
    label_en?: SortOrder
    labels?: SortOrder
    image_url?: SortOrder
    origin?: SortOrder
    cuisine?: SortOrder
    tags?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    lock_no?: SortOrder
  }

  export type dish_categoriesAvgOrderByAggregateInput = {
    lock_no?: SortOrder
  }

  export type dish_categoriesMaxOrderByAggregateInput = {
    id?: SortOrder
    label_en?: SortOrder
    image_url?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    lock_no?: SortOrder
  }

  export type dish_categoriesMinOrderByAggregateInput = {
    id?: SortOrder
    label_en?: SortOrder
    image_url?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    lock_no?: SortOrder
  }

  export type dish_categoriesSumOrderByAggregateInput = {
    lock_no?: SortOrder
  }

  export type StringWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringWithAggregatesFilter<$PrismaModel> | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedStringFilter<$PrismaModel>
    _max?: NestedStringFilter<$PrismaModel>
  }
  export type JsonWithAggregatesFilter<$PrismaModel = never> =
    | PatchUndefined<
        Either<Required<JsonWithAggregatesFilterBase<$PrismaModel>>, Exclude<keyof Required<JsonWithAggregatesFilterBase<$PrismaModel>>, 'path'>>,
        Required<JsonWithAggregatesFilterBase<$PrismaModel>>
      >
    | OptionalFlat<Omit<Required<JsonWithAggregatesFilterBase<$PrismaModel>>, 'path'>>

  export type JsonWithAggregatesFilterBase<$PrismaModel = never> = {
    equals?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    path?: string[]
    mode?: QueryMode | EnumQueryModeFieldRefInput<$PrismaModel>
    string_contains?: string | StringFieldRefInput<$PrismaModel>
    string_starts_with?: string | StringFieldRefInput<$PrismaModel>
    string_ends_with?: string | StringFieldRefInput<$PrismaModel>
    array_starts_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_ends_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_contains?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    lt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    lte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    not?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedJsonFilter<$PrismaModel>
    _max?: NestedJsonFilter<$PrismaModel>
  }

  export type DateTimeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeWithAggregatesFilter<$PrismaModel> | Date | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedDateTimeFilter<$PrismaModel>
    _max?: NestedDateTimeFilter<$PrismaModel>
  }

  export type IntWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedIntFilter<$PrismaModel>
    _min?: NestedIntFilter<$PrismaModel>
    _max?: NestedIntFilter<$PrismaModel>
  }

  export type UuidFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedUuidFilter<$PrismaModel> | string
  }

  export type StringNullableFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringNullableFilter<$PrismaModel> | string | null
  }

  export type Dish_categoriesScalarRelationFilter = {
    is?: dish_categoriesWhereInput
    isNot?: dish_categoriesWhereInput
  }

  export type SortOrderInput = {
    sort: SortOrder
    nulls?: NullsOrder
  }

  export type dish_category_variantsCountOrderByAggregateInput = {
    id?: SortOrder
    dish_category_id?: SortOrder
    surface_form?: SortOrder
    source?: SortOrder
    created_at?: SortOrder
  }

  export type dish_category_variantsMaxOrderByAggregateInput = {
    id?: SortOrder
    dish_category_id?: SortOrder
    surface_form?: SortOrder
    source?: SortOrder
    created_at?: SortOrder
  }

  export type dish_category_variantsMinOrderByAggregateInput = {
    id?: SortOrder
    dish_category_id?: SortOrder
    surface_form?: SortOrder
    source?: SortOrder
    created_at?: SortOrder
  }

  export type UuidWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedUuidWithAggregatesFilter<$PrismaModel> | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedStringFilter<$PrismaModel>
    _max?: NestedStringFilter<$PrismaModel>
  }

  export type StringNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringNullableWithAggregatesFilter<$PrismaModel> | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedStringNullableFilter<$PrismaModel>
    _max?: NestedStringNullableFilter<$PrismaModel>
  }

  export type Dish_mediaScalarRelationFilter = {
    is?: dish_mediaWhereInput
    isNot?: dish_mediaWhereInput
  }

  export type UsersScalarRelationFilter = {
    is?: usersWhereInput
    isNot?: usersWhereInput
  }

  export type dish_likesDish_media_idUser_idCompoundUniqueInput = {
    dish_media_id: string
    user_id: string
  }

  export type dish_likesCountOrderByAggregateInput = {
    id?: SortOrder
    dish_media_id?: SortOrder
    user_id?: SortOrder
    created_at?: SortOrder
  }

  export type dish_likesMaxOrderByAggregateInput = {
    id?: SortOrder
    dish_media_id?: SortOrder
    user_id?: SortOrder
    created_at?: SortOrder
  }

  export type dish_likesMinOrderByAggregateInput = {
    id?: SortOrder
    dish_media_id?: SortOrder
    user_id?: SortOrder
    created_at?: SortOrder
  }

  export type UuidNullableFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedUuidNullableFilter<$PrismaModel> | string | null
  }

  export type Dish_likesListRelationFilter = {
    every?: dish_likesWhereInput
    some?: dish_likesWhereInput
    none?: dish_likesWhereInput
  }

  export type DishesScalarRelationFilter = {
    is?: dishesWhereInput
    isNot?: dishesWhereInput
  }

  export type UsersNullableScalarRelationFilter = {
    is?: usersWhereInput | null
    isNot?: usersWhereInput | null
  }

  export type PayoutsListRelationFilter = {
    every?: payoutsWhereInput
    some?: payoutsWhereInput
    none?: payoutsWhereInput
  }

  export type dish_likesOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type payoutsOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type dish_mediaCountOrderByAggregateInput = {
    id?: SortOrder
    dish_id?: SortOrder
    user_id?: SortOrder
    media_path?: SortOrder
    media_type?: SortOrder
    thumbnail_path?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    lock_no?: SortOrder
  }

  export type dish_mediaAvgOrderByAggregateInput = {
    lock_no?: SortOrder
  }

  export type dish_mediaMaxOrderByAggregateInput = {
    id?: SortOrder
    dish_id?: SortOrder
    user_id?: SortOrder
    media_path?: SortOrder
    media_type?: SortOrder
    thumbnail_path?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    lock_no?: SortOrder
  }

  export type dish_mediaMinOrderByAggregateInput = {
    id?: SortOrder
    dish_id?: SortOrder
    user_id?: SortOrder
    media_path?: SortOrder
    media_type?: SortOrder
    thumbnail_path?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    lock_no?: SortOrder
  }

  export type dish_mediaSumOrderByAggregateInput = {
    lock_no?: SortOrder
  }

  export type UuidNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedUuidNullableWithAggregatesFilter<$PrismaModel> | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedStringNullableFilter<$PrismaModel>
    _max?: NestedStringNullableFilter<$PrismaModel>
  }

  export type IntNullableFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableFilter<$PrismaModel> | number | null
  }

  export type dish_reviewsCountOrderByAggregateInput = {
    id?: SortOrder
    dish_id?: SortOrder
    comment?: SortOrder
    user_id?: SortOrder
    rating?: SortOrder
    price_cents?: SortOrder
    currency_code?: SortOrder
    created_dish_media_id?: SortOrder
    imported_user_name?: SortOrder
    imported_user_avatar?: SortOrder
    created_at?: SortOrder
  }

  export type dish_reviewsAvgOrderByAggregateInput = {
    rating?: SortOrder
    price_cents?: SortOrder
  }

  export type dish_reviewsMaxOrderByAggregateInput = {
    id?: SortOrder
    dish_id?: SortOrder
    comment?: SortOrder
    user_id?: SortOrder
    rating?: SortOrder
    price_cents?: SortOrder
    currency_code?: SortOrder
    created_dish_media_id?: SortOrder
    imported_user_name?: SortOrder
    imported_user_avatar?: SortOrder
    created_at?: SortOrder
  }

  export type dish_reviewsMinOrderByAggregateInput = {
    id?: SortOrder
    dish_id?: SortOrder
    comment?: SortOrder
    user_id?: SortOrder
    rating?: SortOrder
    price_cents?: SortOrder
    currency_code?: SortOrder
    created_dish_media_id?: SortOrder
    imported_user_name?: SortOrder
    imported_user_avatar?: SortOrder
    created_at?: SortOrder
  }

  export type dish_reviewsSumOrderByAggregateInput = {
    rating?: SortOrder
    price_cents?: SortOrder
  }

  export type IntNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableWithAggregatesFilter<$PrismaModel> | number | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _avg?: NestedFloatNullableFilter<$PrismaModel>
    _sum?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedIntNullableFilter<$PrismaModel>
    _max?: NestedIntNullableFilter<$PrismaModel>
  }

  export type Dish_mediaListRelationFilter = {
    every?: dish_mediaWhereInput
    some?: dish_mediaWhereInput
    none?: dish_mediaWhereInput
  }

  export type Dish_reviewsListRelationFilter = {
    every?: dish_reviewsWhereInput
    some?: dish_reviewsWhereInput
    none?: dish_reviewsWhereInput
  }

  export type RestaurantsNullableScalarRelationFilter = {
    is?: restaurantsWhereInput | null
    isNot?: restaurantsWhereInput | null
  }

  export type dish_mediaOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type dish_reviewsOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type dishesCountOrderByAggregateInput = {
    id?: SortOrder
    restaurant_id?: SortOrder
    category_id?: SortOrder
    name?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    lock_no?: SortOrder
  }

  export type dishesAvgOrderByAggregateInput = {
    lock_no?: SortOrder
  }

  export type dishesMaxOrderByAggregateInput = {
    id?: SortOrder
    restaurant_id?: SortOrder
    category_id?: SortOrder
    name?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    lock_no?: SortOrder
  }

  export type dishesMinOrderByAggregateInput = {
    id?: SortOrder
    restaurant_id?: SortOrder
    category_id?: SortOrder
    name?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    lock_no?: SortOrder
  }

  export type dishesSumOrderByAggregateInput = {
    lock_no?: SortOrder
  }

  export type BigIntFilter<$PrismaModel = never> = {
    equals?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    in?: bigint[] | number[] | ListBigIntFieldRefInput<$PrismaModel>
    notIn?: bigint[] | number[] | ListBigIntFieldRefInput<$PrismaModel>
    lt?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    lte?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    gt?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    gte?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    not?: NestedBigIntFilter<$PrismaModel> | bigint | number
  }

  export type Enumpayout_statusFilter<$PrismaModel = never> = {
    equals?: $Enums.payout_status | Enumpayout_statusFieldRefInput<$PrismaModel>
    in?: $Enums.payout_status[] | ListEnumpayout_statusFieldRefInput<$PrismaModel>
    notIn?: $Enums.payout_status[] | ListEnumpayout_statusFieldRefInput<$PrismaModel>
    not?: NestedEnumpayout_statusFilter<$PrismaModel> | $Enums.payout_status
  }

  export type Restaurant_bidsScalarRelationFilter = {
    is?: restaurant_bidsWhereInput
    isNot?: restaurant_bidsWhereInput
  }

  export type payoutsBid_idDish_media_idCompoundUniqueInput = {
    bid_id: string
    dish_media_id: string
  }

  export type payoutsCountOrderByAggregateInput = {
    id?: SortOrder
    bid_id?: SortOrder
    transfer_id?: SortOrder
    dish_media_id?: SortOrder
    amount_cents?: SortOrder
    currency_code?: SortOrder
    status?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    lock_no?: SortOrder
  }

  export type payoutsAvgOrderByAggregateInput = {
    amount_cents?: SortOrder
    lock_no?: SortOrder
  }

  export type payoutsMaxOrderByAggregateInput = {
    id?: SortOrder
    bid_id?: SortOrder
    transfer_id?: SortOrder
    dish_media_id?: SortOrder
    amount_cents?: SortOrder
    currency_code?: SortOrder
    status?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    lock_no?: SortOrder
  }

  export type payoutsMinOrderByAggregateInput = {
    id?: SortOrder
    bid_id?: SortOrder
    transfer_id?: SortOrder
    dish_media_id?: SortOrder
    amount_cents?: SortOrder
    currency_code?: SortOrder
    status?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    lock_no?: SortOrder
  }

  export type payoutsSumOrderByAggregateInput = {
    amount_cents?: SortOrder
    lock_no?: SortOrder
  }

  export type BigIntWithAggregatesFilter<$PrismaModel = never> = {
    equals?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    in?: bigint[] | number[] | ListBigIntFieldRefInput<$PrismaModel>
    notIn?: bigint[] | number[] | ListBigIntFieldRefInput<$PrismaModel>
    lt?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    lte?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    gt?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    gte?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    not?: NestedBigIntWithAggregatesFilter<$PrismaModel> | bigint | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedBigIntFilter<$PrismaModel>
    _min?: NestedBigIntFilter<$PrismaModel>
    _max?: NestedBigIntFilter<$PrismaModel>
  }

  export type Enumpayout_statusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.payout_status | Enumpayout_statusFieldRefInput<$PrismaModel>
    in?: $Enums.payout_status[] | ListEnumpayout_statusFieldRefInput<$PrismaModel>
    notIn?: $Enums.payout_status[] | ListEnumpayout_statusFieldRefInput<$PrismaModel>
    not?: NestedEnumpayout_statusWithAggregatesFilter<$PrismaModel> | $Enums.payout_status
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumpayout_statusFilter<$PrismaModel>
    _max?: NestedEnumpayout_statusFilter<$PrismaModel>
  }

  export type Enumrestaurant_bid_statusFilter<$PrismaModel = never> = {
    equals?: $Enums.restaurant_bid_status | Enumrestaurant_bid_statusFieldRefInput<$PrismaModel>
    in?: $Enums.restaurant_bid_status[] | ListEnumrestaurant_bid_statusFieldRefInput<$PrismaModel>
    notIn?: $Enums.restaurant_bid_status[] | ListEnumrestaurant_bid_statusFieldRefInput<$PrismaModel>
    not?: NestedEnumrestaurant_bid_statusFilter<$PrismaModel> | $Enums.restaurant_bid_status
  }

  export type RestaurantsScalarRelationFilter = {
    is?: restaurantsWhereInput
    isNot?: restaurantsWhereInput
  }

  export type restaurant_bidsCountOrderByAggregateInput = {
    id?: SortOrder
    restaurant_id?: SortOrder
    user_id?: SortOrder
    payment_intent_id?: SortOrder
    amount_cents?: SortOrder
    currency_code?: SortOrder
    start_date?: SortOrder
    end_date?: SortOrder
    status?: SortOrder
    refund_id?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    lock_no?: SortOrder
  }

  export type restaurant_bidsAvgOrderByAggregateInput = {
    amount_cents?: SortOrder
    lock_no?: SortOrder
  }

  export type restaurant_bidsMaxOrderByAggregateInput = {
    id?: SortOrder
    restaurant_id?: SortOrder
    user_id?: SortOrder
    payment_intent_id?: SortOrder
    amount_cents?: SortOrder
    currency_code?: SortOrder
    start_date?: SortOrder
    end_date?: SortOrder
    status?: SortOrder
    refund_id?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    lock_no?: SortOrder
  }

  export type restaurant_bidsMinOrderByAggregateInput = {
    id?: SortOrder
    restaurant_id?: SortOrder
    user_id?: SortOrder
    payment_intent_id?: SortOrder
    amount_cents?: SortOrder
    currency_code?: SortOrder
    start_date?: SortOrder
    end_date?: SortOrder
    status?: SortOrder
    refund_id?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    lock_no?: SortOrder
  }

  export type restaurant_bidsSumOrderByAggregateInput = {
    amount_cents?: SortOrder
    lock_no?: SortOrder
  }

  export type Enumrestaurant_bid_statusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.restaurant_bid_status | Enumrestaurant_bid_statusFieldRefInput<$PrismaModel>
    in?: $Enums.restaurant_bid_status[] | ListEnumrestaurant_bid_statusFieldRefInput<$PrismaModel>
    notIn?: $Enums.restaurant_bid_status[] | ListEnumrestaurant_bid_statusFieldRefInput<$PrismaModel>
    not?: NestedEnumrestaurant_bid_statusWithAggregatesFilter<$PrismaModel> | $Enums.restaurant_bid_status
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumrestaurant_bid_statusFilter<$PrismaModel>
    _max?: NestedEnumrestaurant_bid_statusFilter<$PrismaModel>
  }

  export type Restaurant_bidsListRelationFilter = {
    every?: restaurant_bidsWhereInput
    some?: restaurant_bidsWhereInput
    none?: restaurant_bidsWhereInput
  }

  export type restaurant_bidsOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type restaurantsCountOrderByAggregateInput = {
    id?: SortOrder
    google_place_id?: SortOrder
    name?: SortOrder
    image_url?: SortOrder
    created_at?: SortOrder
  }

  export type restaurantsMaxOrderByAggregateInput = {
    id?: SortOrder
    google_place_id?: SortOrder
    name?: SortOrder
    image_url?: SortOrder
    created_at?: SortOrder
  }

  export type restaurantsMinOrderByAggregateInput = {
    id?: SortOrder
    google_place_id?: SortOrder
    name?: SortOrder
    image_url?: SortOrder
    created_at?: SortOrder
  }

  export type spatial_ref_sysCountOrderByAggregateInput = {
    srid?: SortOrder
    auth_name?: SortOrder
    auth_srid?: SortOrder
    srtext?: SortOrder
    proj4text?: SortOrder
  }

  export type spatial_ref_sysAvgOrderByAggregateInput = {
    srid?: SortOrder
    auth_srid?: SortOrder
  }

  export type spatial_ref_sysMaxOrderByAggregateInput = {
    srid?: SortOrder
    auth_name?: SortOrder
    auth_srid?: SortOrder
    srtext?: SortOrder
    proj4text?: SortOrder
  }

  export type spatial_ref_sysMinOrderByAggregateInput = {
    srid?: SortOrder
    auth_name?: SortOrder
    auth_srid?: SortOrder
    srtext?: SortOrder
    proj4text?: SortOrder
  }

  export type spatial_ref_sysSumOrderByAggregateInput = {
    srid?: SortOrder
    auth_srid?: SortOrder
  }

  export type DateTimeNullableFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableFilter<$PrismaModel> | Date | string | null
  }

  export type usersCountOrderByAggregateInput = {
    id?: SortOrder
    username?: SortOrder
    display_name?: SortOrder
    avatar?: SortOrder
    bio?: SortOrder
    last_login_at?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    lock_no?: SortOrder
  }

  export type usersAvgOrderByAggregateInput = {
    lock_no?: SortOrder
  }

  export type usersMaxOrderByAggregateInput = {
    id?: SortOrder
    username?: SortOrder
    display_name?: SortOrder
    avatar?: SortOrder
    bio?: SortOrder
    last_login_at?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    lock_no?: SortOrder
  }

  export type usersMinOrderByAggregateInput = {
    id?: SortOrder
    username?: SortOrder
    display_name?: SortOrder
    avatar?: SortOrder
    bio?: SortOrder
    last_login_at?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    lock_no?: SortOrder
  }

  export type usersSumOrderByAggregateInput = {
    lock_no?: SortOrder
  }

  export type DateTimeNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableWithAggregatesFilter<$PrismaModel> | Date | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedDateTimeNullableFilter<$PrismaModel>
    _max?: NestedDateTimeNullableFilter<$PrismaModel>
  }

  export type dish_categoriesCreateoriginInput = {
    set: string[]
  }

  export type dish_categoriesCreatecuisineInput = {
    set: string[]
  }

  export type dish_categoriesCreatetagsInput = {
    set: string[]
  }

  export type dish_category_variantsCreateNestedManyWithoutDish_categoriesInput = {
    create?: XOR<dish_category_variantsCreateWithoutDish_categoriesInput, dish_category_variantsUncheckedCreateWithoutDish_categoriesInput> | dish_category_variantsCreateWithoutDish_categoriesInput[] | dish_category_variantsUncheckedCreateWithoutDish_categoriesInput[]
    connectOrCreate?: dish_category_variantsCreateOrConnectWithoutDish_categoriesInput | dish_category_variantsCreateOrConnectWithoutDish_categoriesInput[]
    createMany?: dish_category_variantsCreateManyDish_categoriesInputEnvelope
    connect?: dish_category_variantsWhereUniqueInput | dish_category_variantsWhereUniqueInput[]
  }

  export type dishesCreateNestedManyWithoutDish_categoriesInput = {
    create?: XOR<dishesCreateWithoutDish_categoriesInput, dishesUncheckedCreateWithoutDish_categoriesInput> | dishesCreateWithoutDish_categoriesInput[] | dishesUncheckedCreateWithoutDish_categoriesInput[]
    connectOrCreate?: dishesCreateOrConnectWithoutDish_categoriesInput | dishesCreateOrConnectWithoutDish_categoriesInput[]
    createMany?: dishesCreateManyDish_categoriesInputEnvelope
    connect?: dishesWhereUniqueInput | dishesWhereUniqueInput[]
  }

  export type dish_category_variantsUncheckedCreateNestedManyWithoutDish_categoriesInput = {
    create?: XOR<dish_category_variantsCreateWithoutDish_categoriesInput, dish_category_variantsUncheckedCreateWithoutDish_categoriesInput> | dish_category_variantsCreateWithoutDish_categoriesInput[] | dish_category_variantsUncheckedCreateWithoutDish_categoriesInput[]
    connectOrCreate?: dish_category_variantsCreateOrConnectWithoutDish_categoriesInput | dish_category_variantsCreateOrConnectWithoutDish_categoriesInput[]
    createMany?: dish_category_variantsCreateManyDish_categoriesInputEnvelope
    connect?: dish_category_variantsWhereUniqueInput | dish_category_variantsWhereUniqueInput[]
  }

  export type dishesUncheckedCreateNestedManyWithoutDish_categoriesInput = {
    create?: XOR<dishesCreateWithoutDish_categoriesInput, dishesUncheckedCreateWithoutDish_categoriesInput> | dishesCreateWithoutDish_categoriesInput[] | dishesUncheckedCreateWithoutDish_categoriesInput[]
    connectOrCreate?: dishesCreateOrConnectWithoutDish_categoriesInput | dishesCreateOrConnectWithoutDish_categoriesInput[]
    createMany?: dishesCreateManyDish_categoriesInputEnvelope
    connect?: dishesWhereUniqueInput | dishesWhereUniqueInput[]
  }

  export type StringFieldUpdateOperationsInput = {
    set?: string
  }

  export type dish_categoriesUpdateoriginInput = {
    set?: string[]
    push?: string | string[]
  }

  export type dish_categoriesUpdatecuisineInput = {
    set?: string[]
    push?: string | string[]
  }

  export type dish_categoriesUpdatetagsInput = {
    set?: string[]
    push?: string | string[]
  }

  export type DateTimeFieldUpdateOperationsInput = {
    set?: Date | string
  }

  export type IntFieldUpdateOperationsInput = {
    set?: number
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type dish_category_variantsUpdateManyWithoutDish_categoriesNestedInput = {
    create?: XOR<dish_category_variantsCreateWithoutDish_categoriesInput, dish_category_variantsUncheckedCreateWithoutDish_categoriesInput> | dish_category_variantsCreateWithoutDish_categoriesInput[] | dish_category_variantsUncheckedCreateWithoutDish_categoriesInput[]
    connectOrCreate?: dish_category_variantsCreateOrConnectWithoutDish_categoriesInput | dish_category_variantsCreateOrConnectWithoutDish_categoriesInput[]
    upsert?: dish_category_variantsUpsertWithWhereUniqueWithoutDish_categoriesInput | dish_category_variantsUpsertWithWhereUniqueWithoutDish_categoriesInput[]
    createMany?: dish_category_variantsCreateManyDish_categoriesInputEnvelope
    set?: dish_category_variantsWhereUniqueInput | dish_category_variantsWhereUniqueInput[]
    disconnect?: dish_category_variantsWhereUniqueInput | dish_category_variantsWhereUniqueInput[]
    delete?: dish_category_variantsWhereUniqueInput | dish_category_variantsWhereUniqueInput[]
    connect?: dish_category_variantsWhereUniqueInput | dish_category_variantsWhereUniqueInput[]
    update?: dish_category_variantsUpdateWithWhereUniqueWithoutDish_categoriesInput | dish_category_variantsUpdateWithWhereUniqueWithoutDish_categoriesInput[]
    updateMany?: dish_category_variantsUpdateManyWithWhereWithoutDish_categoriesInput | dish_category_variantsUpdateManyWithWhereWithoutDish_categoriesInput[]
    deleteMany?: dish_category_variantsScalarWhereInput | dish_category_variantsScalarWhereInput[]
  }

  export type dishesUpdateManyWithoutDish_categoriesNestedInput = {
    create?: XOR<dishesCreateWithoutDish_categoriesInput, dishesUncheckedCreateWithoutDish_categoriesInput> | dishesCreateWithoutDish_categoriesInput[] | dishesUncheckedCreateWithoutDish_categoriesInput[]
    connectOrCreate?: dishesCreateOrConnectWithoutDish_categoriesInput | dishesCreateOrConnectWithoutDish_categoriesInput[]
    upsert?: dishesUpsertWithWhereUniqueWithoutDish_categoriesInput | dishesUpsertWithWhereUniqueWithoutDish_categoriesInput[]
    createMany?: dishesCreateManyDish_categoriesInputEnvelope
    set?: dishesWhereUniqueInput | dishesWhereUniqueInput[]
    disconnect?: dishesWhereUniqueInput | dishesWhereUniqueInput[]
    delete?: dishesWhereUniqueInput | dishesWhereUniqueInput[]
    connect?: dishesWhereUniqueInput | dishesWhereUniqueInput[]
    update?: dishesUpdateWithWhereUniqueWithoutDish_categoriesInput | dishesUpdateWithWhereUniqueWithoutDish_categoriesInput[]
    updateMany?: dishesUpdateManyWithWhereWithoutDish_categoriesInput | dishesUpdateManyWithWhereWithoutDish_categoriesInput[]
    deleteMany?: dishesScalarWhereInput | dishesScalarWhereInput[]
  }

  export type dish_category_variantsUncheckedUpdateManyWithoutDish_categoriesNestedInput = {
    create?: XOR<dish_category_variantsCreateWithoutDish_categoriesInput, dish_category_variantsUncheckedCreateWithoutDish_categoriesInput> | dish_category_variantsCreateWithoutDish_categoriesInput[] | dish_category_variantsUncheckedCreateWithoutDish_categoriesInput[]
    connectOrCreate?: dish_category_variantsCreateOrConnectWithoutDish_categoriesInput | dish_category_variantsCreateOrConnectWithoutDish_categoriesInput[]
    upsert?: dish_category_variantsUpsertWithWhereUniqueWithoutDish_categoriesInput | dish_category_variantsUpsertWithWhereUniqueWithoutDish_categoriesInput[]
    createMany?: dish_category_variantsCreateManyDish_categoriesInputEnvelope
    set?: dish_category_variantsWhereUniqueInput | dish_category_variantsWhereUniqueInput[]
    disconnect?: dish_category_variantsWhereUniqueInput | dish_category_variantsWhereUniqueInput[]
    delete?: dish_category_variantsWhereUniqueInput | dish_category_variantsWhereUniqueInput[]
    connect?: dish_category_variantsWhereUniqueInput | dish_category_variantsWhereUniqueInput[]
    update?: dish_category_variantsUpdateWithWhereUniqueWithoutDish_categoriesInput | dish_category_variantsUpdateWithWhereUniqueWithoutDish_categoriesInput[]
    updateMany?: dish_category_variantsUpdateManyWithWhereWithoutDish_categoriesInput | dish_category_variantsUpdateManyWithWhereWithoutDish_categoriesInput[]
    deleteMany?: dish_category_variantsScalarWhereInput | dish_category_variantsScalarWhereInput[]
  }

  export type dishesUncheckedUpdateManyWithoutDish_categoriesNestedInput = {
    create?: XOR<dishesCreateWithoutDish_categoriesInput, dishesUncheckedCreateWithoutDish_categoriesInput> | dishesCreateWithoutDish_categoriesInput[] | dishesUncheckedCreateWithoutDish_categoriesInput[]
    connectOrCreate?: dishesCreateOrConnectWithoutDish_categoriesInput | dishesCreateOrConnectWithoutDish_categoriesInput[]
    upsert?: dishesUpsertWithWhereUniqueWithoutDish_categoriesInput | dishesUpsertWithWhereUniqueWithoutDish_categoriesInput[]
    createMany?: dishesCreateManyDish_categoriesInputEnvelope
    set?: dishesWhereUniqueInput | dishesWhereUniqueInput[]
    disconnect?: dishesWhereUniqueInput | dishesWhereUniqueInput[]
    delete?: dishesWhereUniqueInput | dishesWhereUniqueInput[]
    connect?: dishesWhereUniqueInput | dishesWhereUniqueInput[]
    update?: dishesUpdateWithWhereUniqueWithoutDish_categoriesInput | dishesUpdateWithWhereUniqueWithoutDish_categoriesInput[]
    updateMany?: dishesUpdateManyWithWhereWithoutDish_categoriesInput | dishesUpdateManyWithWhereWithoutDish_categoriesInput[]
    deleteMany?: dishesScalarWhereInput | dishesScalarWhereInput[]
  }

  export type dish_categoriesCreateNestedOneWithoutDish_category_variantsInput = {
    create?: XOR<dish_categoriesCreateWithoutDish_category_variantsInput, dish_categoriesUncheckedCreateWithoutDish_category_variantsInput>
    connectOrCreate?: dish_categoriesCreateOrConnectWithoutDish_category_variantsInput
    connect?: dish_categoriesWhereUniqueInput
  }

  export type NullableStringFieldUpdateOperationsInput = {
    set?: string | null
  }

  export type dish_categoriesUpdateOneRequiredWithoutDish_category_variantsNestedInput = {
    create?: XOR<dish_categoriesCreateWithoutDish_category_variantsInput, dish_categoriesUncheckedCreateWithoutDish_category_variantsInput>
    connectOrCreate?: dish_categoriesCreateOrConnectWithoutDish_category_variantsInput
    upsert?: dish_categoriesUpsertWithoutDish_category_variantsInput
    connect?: dish_categoriesWhereUniqueInput
    update?: XOR<XOR<dish_categoriesUpdateToOneWithWhereWithoutDish_category_variantsInput, dish_categoriesUpdateWithoutDish_category_variantsInput>, dish_categoriesUncheckedUpdateWithoutDish_category_variantsInput>
  }

  export type dish_mediaCreateNestedOneWithoutDish_likesInput = {
    create?: XOR<dish_mediaCreateWithoutDish_likesInput, dish_mediaUncheckedCreateWithoutDish_likesInput>
    connectOrCreate?: dish_mediaCreateOrConnectWithoutDish_likesInput
    connect?: dish_mediaWhereUniqueInput
  }

  export type usersCreateNestedOneWithoutDish_likesInput = {
    create?: XOR<usersCreateWithoutDish_likesInput, usersUncheckedCreateWithoutDish_likesInput>
    connectOrCreate?: usersCreateOrConnectWithoutDish_likesInput
    connect?: usersWhereUniqueInput
  }

  export type dish_mediaUpdateOneRequiredWithoutDish_likesNestedInput = {
    create?: XOR<dish_mediaCreateWithoutDish_likesInput, dish_mediaUncheckedCreateWithoutDish_likesInput>
    connectOrCreate?: dish_mediaCreateOrConnectWithoutDish_likesInput
    upsert?: dish_mediaUpsertWithoutDish_likesInput
    connect?: dish_mediaWhereUniqueInput
    update?: XOR<XOR<dish_mediaUpdateToOneWithWhereWithoutDish_likesInput, dish_mediaUpdateWithoutDish_likesInput>, dish_mediaUncheckedUpdateWithoutDish_likesInput>
  }

  export type usersUpdateOneRequiredWithoutDish_likesNestedInput = {
    create?: XOR<usersCreateWithoutDish_likesInput, usersUncheckedCreateWithoutDish_likesInput>
    connectOrCreate?: usersCreateOrConnectWithoutDish_likesInput
    upsert?: usersUpsertWithoutDish_likesInput
    connect?: usersWhereUniqueInput
    update?: XOR<XOR<usersUpdateToOneWithWhereWithoutDish_likesInput, usersUpdateWithoutDish_likesInput>, usersUncheckedUpdateWithoutDish_likesInput>
  }

  export type dish_likesCreateNestedManyWithoutDish_mediaInput = {
    create?: XOR<dish_likesCreateWithoutDish_mediaInput, dish_likesUncheckedCreateWithoutDish_mediaInput> | dish_likesCreateWithoutDish_mediaInput[] | dish_likesUncheckedCreateWithoutDish_mediaInput[]
    connectOrCreate?: dish_likesCreateOrConnectWithoutDish_mediaInput | dish_likesCreateOrConnectWithoutDish_mediaInput[]
    createMany?: dish_likesCreateManyDish_mediaInputEnvelope
    connect?: dish_likesWhereUniqueInput | dish_likesWhereUniqueInput[]
  }

  export type dishesCreateNestedOneWithoutDish_mediaInput = {
    create?: XOR<dishesCreateWithoutDish_mediaInput, dishesUncheckedCreateWithoutDish_mediaInput>
    connectOrCreate?: dishesCreateOrConnectWithoutDish_mediaInput
    connect?: dishesWhereUniqueInput
  }

  export type usersCreateNestedOneWithoutDish_mediaInput = {
    create?: XOR<usersCreateWithoutDish_mediaInput, usersUncheckedCreateWithoutDish_mediaInput>
    connectOrCreate?: usersCreateOrConnectWithoutDish_mediaInput
    connect?: usersWhereUniqueInput
  }

  export type payoutsCreateNestedManyWithoutDish_mediaInput = {
    create?: XOR<payoutsCreateWithoutDish_mediaInput, payoutsUncheckedCreateWithoutDish_mediaInput> | payoutsCreateWithoutDish_mediaInput[] | payoutsUncheckedCreateWithoutDish_mediaInput[]
    connectOrCreate?: payoutsCreateOrConnectWithoutDish_mediaInput | payoutsCreateOrConnectWithoutDish_mediaInput[]
    createMany?: payoutsCreateManyDish_mediaInputEnvelope
    connect?: payoutsWhereUniqueInput | payoutsWhereUniqueInput[]
  }

  export type dish_likesUncheckedCreateNestedManyWithoutDish_mediaInput = {
    create?: XOR<dish_likesCreateWithoutDish_mediaInput, dish_likesUncheckedCreateWithoutDish_mediaInput> | dish_likesCreateWithoutDish_mediaInput[] | dish_likesUncheckedCreateWithoutDish_mediaInput[]
    connectOrCreate?: dish_likesCreateOrConnectWithoutDish_mediaInput | dish_likesCreateOrConnectWithoutDish_mediaInput[]
    createMany?: dish_likesCreateManyDish_mediaInputEnvelope
    connect?: dish_likesWhereUniqueInput | dish_likesWhereUniqueInput[]
  }

  export type payoutsUncheckedCreateNestedManyWithoutDish_mediaInput = {
    create?: XOR<payoutsCreateWithoutDish_mediaInput, payoutsUncheckedCreateWithoutDish_mediaInput> | payoutsCreateWithoutDish_mediaInput[] | payoutsUncheckedCreateWithoutDish_mediaInput[]
    connectOrCreate?: payoutsCreateOrConnectWithoutDish_mediaInput | payoutsCreateOrConnectWithoutDish_mediaInput[]
    createMany?: payoutsCreateManyDish_mediaInputEnvelope
    connect?: payoutsWhereUniqueInput | payoutsWhereUniqueInput[]
  }

  export type dish_likesUpdateManyWithoutDish_mediaNestedInput = {
    create?: XOR<dish_likesCreateWithoutDish_mediaInput, dish_likesUncheckedCreateWithoutDish_mediaInput> | dish_likesCreateWithoutDish_mediaInput[] | dish_likesUncheckedCreateWithoutDish_mediaInput[]
    connectOrCreate?: dish_likesCreateOrConnectWithoutDish_mediaInput | dish_likesCreateOrConnectWithoutDish_mediaInput[]
    upsert?: dish_likesUpsertWithWhereUniqueWithoutDish_mediaInput | dish_likesUpsertWithWhereUniqueWithoutDish_mediaInput[]
    createMany?: dish_likesCreateManyDish_mediaInputEnvelope
    set?: dish_likesWhereUniqueInput | dish_likesWhereUniqueInput[]
    disconnect?: dish_likesWhereUniqueInput | dish_likesWhereUniqueInput[]
    delete?: dish_likesWhereUniqueInput | dish_likesWhereUniqueInput[]
    connect?: dish_likesWhereUniqueInput | dish_likesWhereUniqueInput[]
    update?: dish_likesUpdateWithWhereUniqueWithoutDish_mediaInput | dish_likesUpdateWithWhereUniqueWithoutDish_mediaInput[]
    updateMany?: dish_likesUpdateManyWithWhereWithoutDish_mediaInput | dish_likesUpdateManyWithWhereWithoutDish_mediaInput[]
    deleteMany?: dish_likesScalarWhereInput | dish_likesScalarWhereInput[]
  }

  export type dishesUpdateOneRequiredWithoutDish_mediaNestedInput = {
    create?: XOR<dishesCreateWithoutDish_mediaInput, dishesUncheckedCreateWithoutDish_mediaInput>
    connectOrCreate?: dishesCreateOrConnectWithoutDish_mediaInput
    upsert?: dishesUpsertWithoutDish_mediaInput
    connect?: dishesWhereUniqueInput
    update?: XOR<XOR<dishesUpdateToOneWithWhereWithoutDish_mediaInput, dishesUpdateWithoutDish_mediaInput>, dishesUncheckedUpdateWithoutDish_mediaInput>
  }

  export type usersUpdateOneWithoutDish_mediaNestedInput = {
    create?: XOR<usersCreateWithoutDish_mediaInput, usersUncheckedCreateWithoutDish_mediaInput>
    connectOrCreate?: usersCreateOrConnectWithoutDish_mediaInput
    upsert?: usersUpsertWithoutDish_mediaInput
    disconnect?: usersWhereInput | boolean
    delete?: usersWhereInput | boolean
    connect?: usersWhereUniqueInput
    update?: XOR<XOR<usersUpdateToOneWithWhereWithoutDish_mediaInput, usersUpdateWithoutDish_mediaInput>, usersUncheckedUpdateWithoutDish_mediaInput>
  }

  export type payoutsUpdateManyWithoutDish_mediaNestedInput = {
    create?: XOR<payoutsCreateWithoutDish_mediaInput, payoutsUncheckedCreateWithoutDish_mediaInput> | payoutsCreateWithoutDish_mediaInput[] | payoutsUncheckedCreateWithoutDish_mediaInput[]
    connectOrCreate?: payoutsCreateOrConnectWithoutDish_mediaInput | payoutsCreateOrConnectWithoutDish_mediaInput[]
    upsert?: payoutsUpsertWithWhereUniqueWithoutDish_mediaInput | payoutsUpsertWithWhereUniqueWithoutDish_mediaInput[]
    createMany?: payoutsCreateManyDish_mediaInputEnvelope
    set?: payoutsWhereUniqueInput | payoutsWhereUniqueInput[]
    disconnect?: payoutsWhereUniqueInput | payoutsWhereUniqueInput[]
    delete?: payoutsWhereUniqueInput | payoutsWhereUniqueInput[]
    connect?: payoutsWhereUniqueInput | payoutsWhereUniqueInput[]
    update?: payoutsUpdateWithWhereUniqueWithoutDish_mediaInput | payoutsUpdateWithWhereUniqueWithoutDish_mediaInput[]
    updateMany?: payoutsUpdateManyWithWhereWithoutDish_mediaInput | payoutsUpdateManyWithWhereWithoutDish_mediaInput[]
    deleteMany?: payoutsScalarWhereInput | payoutsScalarWhereInput[]
  }

  export type dish_likesUncheckedUpdateManyWithoutDish_mediaNestedInput = {
    create?: XOR<dish_likesCreateWithoutDish_mediaInput, dish_likesUncheckedCreateWithoutDish_mediaInput> | dish_likesCreateWithoutDish_mediaInput[] | dish_likesUncheckedCreateWithoutDish_mediaInput[]
    connectOrCreate?: dish_likesCreateOrConnectWithoutDish_mediaInput | dish_likesCreateOrConnectWithoutDish_mediaInput[]
    upsert?: dish_likesUpsertWithWhereUniqueWithoutDish_mediaInput | dish_likesUpsertWithWhereUniqueWithoutDish_mediaInput[]
    createMany?: dish_likesCreateManyDish_mediaInputEnvelope
    set?: dish_likesWhereUniqueInput | dish_likesWhereUniqueInput[]
    disconnect?: dish_likesWhereUniqueInput | dish_likesWhereUniqueInput[]
    delete?: dish_likesWhereUniqueInput | dish_likesWhereUniqueInput[]
    connect?: dish_likesWhereUniqueInput | dish_likesWhereUniqueInput[]
    update?: dish_likesUpdateWithWhereUniqueWithoutDish_mediaInput | dish_likesUpdateWithWhereUniqueWithoutDish_mediaInput[]
    updateMany?: dish_likesUpdateManyWithWhereWithoutDish_mediaInput | dish_likesUpdateManyWithWhereWithoutDish_mediaInput[]
    deleteMany?: dish_likesScalarWhereInput | dish_likesScalarWhereInput[]
  }

  export type payoutsUncheckedUpdateManyWithoutDish_mediaNestedInput = {
    create?: XOR<payoutsCreateWithoutDish_mediaInput, payoutsUncheckedCreateWithoutDish_mediaInput> | payoutsCreateWithoutDish_mediaInput[] | payoutsUncheckedCreateWithoutDish_mediaInput[]
    connectOrCreate?: payoutsCreateOrConnectWithoutDish_mediaInput | payoutsCreateOrConnectWithoutDish_mediaInput[]
    upsert?: payoutsUpsertWithWhereUniqueWithoutDish_mediaInput | payoutsUpsertWithWhereUniqueWithoutDish_mediaInput[]
    createMany?: payoutsCreateManyDish_mediaInputEnvelope
    set?: payoutsWhereUniqueInput | payoutsWhereUniqueInput[]
    disconnect?: payoutsWhereUniqueInput | payoutsWhereUniqueInput[]
    delete?: payoutsWhereUniqueInput | payoutsWhereUniqueInput[]
    connect?: payoutsWhereUniqueInput | payoutsWhereUniqueInput[]
    update?: payoutsUpdateWithWhereUniqueWithoutDish_mediaInput | payoutsUpdateWithWhereUniqueWithoutDish_mediaInput[]
    updateMany?: payoutsUpdateManyWithWhereWithoutDish_mediaInput | payoutsUpdateManyWithWhereWithoutDish_mediaInput[]
    deleteMany?: payoutsScalarWhereInput | payoutsScalarWhereInput[]
  }

  export type dishesCreateNestedOneWithoutDish_reviewsInput = {
    create?: XOR<dishesCreateWithoutDish_reviewsInput, dishesUncheckedCreateWithoutDish_reviewsInput>
    connectOrCreate?: dishesCreateOrConnectWithoutDish_reviewsInput
    connect?: dishesWhereUniqueInput
  }

  export type usersCreateNestedOneWithoutDish_reviewsInput = {
    create?: XOR<usersCreateWithoutDish_reviewsInput, usersUncheckedCreateWithoutDish_reviewsInput>
    connectOrCreate?: usersCreateOrConnectWithoutDish_reviewsInput
    connect?: usersWhereUniqueInput
  }

  export type NullableIntFieldUpdateOperationsInput = {
    set?: number | null
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type dishesUpdateOneRequiredWithoutDish_reviewsNestedInput = {
    create?: XOR<dishesCreateWithoutDish_reviewsInput, dishesUncheckedCreateWithoutDish_reviewsInput>
    connectOrCreate?: dishesCreateOrConnectWithoutDish_reviewsInput
    upsert?: dishesUpsertWithoutDish_reviewsInput
    connect?: dishesWhereUniqueInput
    update?: XOR<XOR<dishesUpdateToOneWithWhereWithoutDish_reviewsInput, dishesUpdateWithoutDish_reviewsInput>, dishesUncheckedUpdateWithoutDish_reviewsInput>
  }

  export type usersUpdateOneWithoutDish_reviewsNestedInput = {
    create?: XOR<usersCreateWithoutDish_reviewsInput, usersUncheckedCreateWithoutDish_reviewsInput>
    connectOrCreate?: usersCreateOrConnectWithoutDish_reviewsInput
    upsert?: usersUpsertWithoutDish_reviewsInput
    disconnect?: usersWhereInput | boolean
    delete?: usersWhereInput | boolean
    connect?: usersWhereUniqueInput
    update?: XOR<XOR<usersUpdateToOneWithWhereWithoutDish_reviewsInput, usersUpdateWithoutDish_reviewsInput>, usersUncheckedUpdateWithoutDish_reviewsInput>
  }

  export type dish_mediaCreateNestedManyWithoutDishesInput = {
    create?: XOR<dish_mediaCreateWithoutDishesInput, dish_mediaUncheckedCreateWithoutDishesInput> | dish_mediaCreateWithoutDishesInput[] | dish_mediaUncheckedCreateWithoutDishesInput[]
    connectOrCreate?: dish_mediaCreateOrConnectWithoutDishesInput | dish_mediaCreateOrConnectWithoutDishesInput[]
    createMany?: dish_mediaCreateManyDishesInputEnvelope
    connect?: dish_mediaWhereUniqueInput | dish_mediaWhereUniqueInput[]
  }

  export type dish_reviewsCreateNestedManyWithoutDishesInput = {
    create?: XOR<dish_reviewsCreateWithoutDishesInput, dish_reviewsUncheckedCreateWithoutDishesInput> | dish_reviewsCreateWithoutDishesInput[] | dish_reviewsUncheckedCreateWithoutDishesInput[]
    connectOrCreate?: dish_reviewsCreateOrConnectWithoutDishesInput | dish_reviewsCreateOrConnectWithoutDishesInput[]
    createMany?: dish_reviewsCreateManyDishesInputEnvelope
    connect?: dish_reviewsWhereUniqueInput | dish_reviewsWhereUniqueInput[]
  }

  export type dish_categoriesCreateNestedOneWithoutDishesInput = {
    create?: XOR<dish_categoriesCreateWithoutDishesInput, dish_categoriesUncheckedCreateWithoutDishesInput>
    connectOrCreate?: dish_categoriesCreateOrConnectWithoutDishesInput
    connect?: dish_categoriesWhereUniqueInput
  }

  export type restaurantsCreateNestedOneWithoutDishesInput = {
    connect?: restaurantsWhereUniqueInput
  }

  export type dish_mediaUncheckedCreateNestedManyWithoutDishesInput = {
    create?: XOR<dish_mediaCreateWithoutDishesInput, dish_mediaUncheckedCreateWithoutDishesInput> | dish_mediaCreateWithoutDishesInput[] | dish_mediaUncheckedCreateWithoutDishesInput[]
    connectOrCreate?: dish_mediaCreateOrConnectWithoutDishesInput | dish_mediaCreateOrConnectWithoutDishesInput[]
    createMany?: dish_mediaCreateManyDishesInputEnvelope
    connect?: dish_mediaWhereUniqueInput | dish_mediaWhereUniqueInput[]
  }

  export type dish_reviewsUncheckedCreateNestedManyWithoutDishesInput = {
    create?: XOR<dish_reviewsCreateWithoutDishesInput, dish_reviewsUncheckedCreateWithoutDishesInput> | dish_reviewsCreateWithoutDishesInput[] | dish_reviewsUncheckedCreateWithoutDishesInput[]
    connectOrCreate?: dish_reviewsCreateOrConnectWithoutDishesInput | dish_reviewsCreateOrConnectWithoutDishesInput[]
    createMany?: dish_reviewsCreateManyDishesInputEnvelope
    connect?: dish_reviewsWhereUniqueInput | dish_reviewsWhereUniqueInput[]
  }

  export type dish_mediaUpdateManyWithoutDishesNestedInput = {
    create?: XOR<dish_mediaCreateWithoutDishesInput, dish_mediaUncheckedCreateWithoutDishesInput> | dish_mediaCreateWithoutDishesInput[] | dish_mediaUncheckedCreateWithoutDishesInput[]
    connectOrCreate?: dish_mediaCreateOrConnectWithoutDishesInput | dish_mediaCreateOrConnectWithoutDishesInput[]
    upsert?: dish_mediaUpsertWithWhereUniqueWithoutDishesInput | dish_mediaUpsertWithWhereUniqueWithoutDishesInput[]
    createMany?: dish_mediaCreateManyDishesInputEnvelope
    set?: dish_mediaWhereUniqueInput | dish_mediaWhereUniqueInput[]
    disconnect?: dish_mediaWhereUniqueInput | dish_mediaWhereUniqueInput[]
    delete?: dish_mediaWhereUniqueInput | dish_mediaWhereUniqueInput[]
    connect?: dish_mediaWhereUniqueInput | dish_mediaWhereUniqueInput[]
    update?: dish_mediaUpdateWithWhereUniqueWithoutDishesInput | dish_mediaUpdateWithWhereUniqueWithoutDishesInput[]
    updateMany?: dish_mediaUpdateManyWithWhereWithoutDishesInput | dish_mediaUpdateManyWithWhereWithoutDishesInput[]
    deleteMany?: dish_mediaScalarWhereInput | dish_mediaScalarWhereInput[]
  }

  export type dish_reviewsUpdateManyWithoutDishesNestedInput = {
    create?: XOR<dish_reviewsCreateWithoutDishesInput, dish_reviewsUncheckedCreateWithoutDishesInput> | dish_reviewsCreateWithoutDishesInput[] | dish_reviewsUncheckedCreateWithoutDishesInput[]
    connectOrCreate?: dish_reviewsCreateOrConnectWithoutDishesInput | dish_reviewsCreateOrConnectWithoutDishesInput[]
    upsert?: dish_reviewsUpsertWithWhereUniqueWithoutDishesInput | dish_reviewsUpsertWithWhereUniqueWithoutDishesInput[]
    createMany?: dish_reviewsCreateManyDishesInputEnvelope
    set?: dish_reviewsWhereUniqueInput | dish_reviewsWhereUniqueInput[]
    disconnect?: dish_reviewsWhereUniqueInput | dish_reviewsWhereUniqueInput[]
    delete?: dish_reviewsWhereUniqueInput | dish_reviewsWhereUniqueInput[]
    connect?: dish_reviewsWhereUniqueInput | dish_reviewsWhereUniqueInput[]
    update?: dish_reviewsUpdateWithWhereUniqueWithoutDishesInput | dish_reviewsUpdateWithWhereUniqueWithoutDishesInput[]
    updateMany?: dish_reviewsUpdateManyWithWhereWithoutDishesInput | dish_reviewsUpdateManyWithWhereWithoutDishesInput[]
    deleteMany?: dish_reviewsScalarWhereInput | dish_reviewsScalarWhereInput[]
  }

  export type dish_categoriesUpdateOneRequiredWithoutDishesNestedInput = {
    create?: XOR<dish_categoriesCreateWithoutDishesInput, dish_categoriesUncheckedCreateWithoutDishesInput>
    connectOrCreate?: dish_categoriesCreateOrConnectWithoutDishesInput
    upsert?: dish_categoriesUpsertWithoutDishesInput
    connect?: dish_categoriesWhereUniqueInput
    update?: XOR<XOR<dish_categoriesUpdateToOneWithWhereWithoutDishesInput, dish_categoriesUpdateWithoutDishesInput>, dish_categoriesUncheckedUpdateWithoutDishesInput>
  }

  export type restaurantsUpdateOneWithoutDishesNestedInput = {
    disconnect?: restaurantsWhereInput | boolean
    delete?: restaurantsWhereInput | boolean
    connect?: restaurantsWhereUniqueInput
    update?: XOR<XOR<restaurantsUpdateToOneWithWhereWithoutDishesInput, restaurantsUpdateWithoutDishesInput>, restaurantsUncheckedUpdateWithoutDishesInput>
  }

  export type dish_mediaUncheckedUpdateManyWithoutDishesNestedInput = {
    create?: XOR<dish_mediaCreateWithoutDishesInput, dish_mediaUncheckedCreateWithoutDishesInput> | dish_mediaCreateWithoutDishesInput[] | dish_mediaUncheckedCreateWithoutDishesInput[]
    connectOrCreate?: dish_mediaCreateOrConnectWithoutDishesInput | dish_mediaCreateOrConnectWithoutDishesInput[]
    upsert?: dish_mediaUpsertWithWhereUniqueWithoutDishesInput | dish_mediaUpsertWithWhereUniqueWithoutDishesInput[]
    createMany?: dish_mediaCreateManyDishesInputEnvelope
    set?: dish_mediaWhereUniqueInput | dish_mediaWhereUniqueInput[]
    disconnect?: dish_mediaWhereUniqueInput | dish_mediaWhereUniqueInput[]
    delete?: dish_mediaWhereUniqueInput | dish_mediaWhereUniqueInput[]
    connect?: dish_mediaWhereUniqueInput | dish_mediaWhereUniqueInput[]
    update?: dish_mediaUpdateWithWhereUniqueWithoutDishesInput | dish_mediaUpdateWithWhereUniqueWithoutDishesInput[]
    updateMany?: dish_mediaUpdateManyWithWhereWithoutDishesInput | dish_mediaUpdateManyWithWhereWithoutDishesInput[]
    deleteMany?: dish_mediaScalarWhereInput | dish_mediaScalarWhereInput[]
  }

  export type dish_reviewsUncheckedUpdateManyWithoutDishesNestedInput = {
    create?: XOR<dish_reviewsCreateWithoutDishesInput, dish_reviewsUncheckedCreateWithoutDishesInput> | dish_reviewsCreateWithoutDishesInput[] | dish_reviewsUncheckedCreateWithoutDishesInput[]
    connectOrCreate?: dish_reviewsCreateOrConnectWithoutDishesInput | dish_reviewsCreateOrConnectWithoutDishesInput[]
    upsert?: dish_reviewsUpsertWithWhereUniqueWithoutDishesInput | dish_reviewsUpsertWithWhereUniqueWithoutDishesInput[]
    createMany?: dish_reviewsCreateManyDishesInputEnvelope
    set?: dish_reviewsWhereUniqueInput | dish_reviewsWhereUniqueInput[]
    disconnect?: dish_reviewsWhereUniqueInput | dish_reviewsWhereUniqueInput[]
    delete?: dish_reviewsWhereUniqueInput | dish_reviewsWhereUniqueInput[]
    connect?: dish_reviewsWhereUniqueInput | dish_reviewsWhereUniqueInput[]
    update?: dish_reviewsUpdateWithWhereUniqueWithoutDishesInput | dish_reviewsUpdateWithWhereUniqueWithoutDishesInput[]
    updateMany?: dish_reviewsUpdateManyWithWhereWithoutDishesInput | dish_reviewsUpdateManyWithWhereWithoutDishesInput[]
    deleteMany?: dish_reviewsScalarWhereInput | dish_reviewsScalarWhereInput[]
  }

  export type restaurant_bidsCreateNestedOneWithoutPayoutsInput = {
    create?: XOR<restaurant_bidsCreateWithoutPayoutsInput, restaurant_bidsUncheckedCreateWithoutPayoutsInput>
    connectOrCreate?: restaurant_bidsCreateOrConnectWithoutPayoutsInput
    connect?: restaurant_bidsWhereUniqueInput
  }

  export type dish_mediaCreateNestedOneWithoutPayoutsInput = {
    create?: XOR<dish_mediaCreateWithoutPayoutsInput, dish_mediaUncheckedCreateWithoutPayoutsInput>
    connectOrCreate?: dish_mediaCreateOrConnectWithoutPayoutsInput
    connect?: dish_mediaWhereUniqueInput
  }

  export type BigIntFieldUpdateOperationsInput = {
    set?: bigint | number
    increment?: bigint | number
    decrement?: bigint | number
    multiply?: bigint | number
    divide?: bigint | number
  }

  export type Enumpayout_statusFieldUpdateOperationsInput = {
    set?: $Enums.payout_status
  }

  export type restaurant_bidsUpdateOneRequiredWithoutPayoutsNestedInput = {
    create?: XOR<restaurant_bidsCreateWithoutPayoutsInput, restaurant_bidsUncheckedCreateWithoutPayoutsInput>
    connectOrCreate?: restaurant_bidsCreateOrConnectWithoutPayoutsInput
    upsert?: restaurant_bidsUpsertWithoutPayoutsInput
    connect?: restaurant_bidsWhereUniqueInput
    update?: XOR<XOR<restaurant_bidsUpdateToOneWithWhereWithoutPayoutsInput, restaurant_bidsUpdateWithoutPayoutsInput>, restaurant_bidsUncheckedUpdateWithoutPayoutsInput>
  }

  export type dish_mediaUpdateOneRequiredWithoutPayoutsNestedInput = {
    create?: XOR<dish_mediaCreateWithoutPayoutsInput, dish_mediaUncheckedCreateWithoutPayoutsInput>
    connectOrCreate?: dish_mediaCreateOrConnectWithoutPayoutsInput
    upsert?: dish_mediaUpsertWithoutPayoutsInput
    connect?: dish_mediaWhereUniqueInput
    update?: XOR<XOR<dish_mediaUpdateToOneWithWhereWithoutPayoutsInput, dish_mediaUpdateWithoutPayoutsInput>, dish_mediaUncheckedUpdateWithoutPayoutsInput>
  }

  export type payoutsCreateNestedManyWithoutRestaurant_bidsInput = {
    create?: XOR<payoutsCreateWithoutRestaurant_bidsInput, payoutsUncheckedCreateWithoutRestaurant_bidsInput> | payoutsCreateWithoutRestaurant_bidsInput[] | payoutsUncheckedCreateWithoutRestaurant_bidsInput[]
    connectOrCreate?: payoutsCreateOrConnectWithoutRestaurant_bidsInput | payoutsCreateOrConnectWithoutRestaurant_bidsInput[]
    createMany?: payoutsCreateManyRestaurant_bidsInputEnvelope
    connect?: payoutsWhereUniqueInput | payoutsWhereUniqueInput[]
  }

  export type restaurantsCreateNestedOneWithoutRestaurant_bidsInput = {
    connect?: restaurantsWhereUniqueInput
  }

  export type usersCreateNestedOneWithoutRestaurant_bidsInput = {
    create?: XOR<usersCreateWithoutRestaurant_bidsInput, usersUncheckedCreateWithoutRestaurant_bidsInput>
    connectOrCreate?: usersCreateOrConnectWithoutRestaurant_bidsInput
    connect?: usersWhereUniqueInput
  }

  export type payoutsUncheckedCreateNestedManyWithoutRestaurant_bidsInput = {
    create?: XOR<payoutsCreateWithoutRestaurant_bidsInput, payoutsUncheckedCreateWithoutRestaurant_bidsInput> | payoutsCreateWithoutRestaurant_bidsInput[] | payoutsUncheckedCreateWithoutRestaurant_bidsInput[]
    connectOrCreate?: payoutsCreateOrConnectWithoutRestaurant_bidsInput | payoutsCreateOrConnectWithoutRestaurant_bidsInput[]
    createMany?: payoutsCreateManyRestaurant_bidsInputEnvelope
    connect?: payoutsWhereUniqueInput | payoutsWhereUniqueInput[]
  }

  export type Enumrestaurant_bid_statusFieldUpdateOperationsInput = {
    set?: $Enums.restaurant_bid_status
  }

  export type payoutsUpdateManyWithoutRestaurant_bidsNestedInput = {
    create?: XOR<payoutsCreateWithoutRestaurant_bidsInput, payoutsUncheckedCreateWithoutRestaurant_bidsInput> | payoutsCreateWithoutRestaurant_bidsInput[] | payoutsUncheckedCreateWithoutRestaurant_bidsInput[]
    connectOrCreate?: payoutsCreateOrConnectWithoutRestaurant_bidsInput | payoutsCreateOrConnectWithoutRestaurant_bidsInput[]
    upsert?: payoutsUpsertWithWhereUniqueWithoutRestaurant_bidsInput | payoutsUpsertWithWhereUniqueWithoutRestaurant_bidsInput[]
    createMany?: payoutsCreateManyRestaurant_bidsInputEnvelope
    set?: payoutsWhereUniqueInput | payoutsWhereUniqueInput[]
    disconnect?: payoutsWhereUniqueInput | payoutsWhereUniqueInput[]
    delete?: payoutsWhereUniqueInput | payoutsWhereUniqueInput[]
    connect?: payoutsWhereUniqueInput | payoutsWhereUniqueInput[]
    update?: payoutsUpdateWithWhereUniqueWithoutRestaurant_bidsInput | payoutsUpdateWithWhereUniqueWithoutRestaurant_bidsInput[]
    updateMany?: payoutsUpdateManyWithWhereWithoutRestaurant_bidsInput | payoutsUpdateManyWithWhereWithoutRestaurant_bidsInput[]
    deleteMany?: payoutsScalarWhereInput | payoutsScalarWhereInput[]
  }

  export type restaurantsUpdateOneRequiredWithoutRestaurant_bidsNestedInput = {
    connect?: restaurantsWhereUniqueInput
    update?: XOR<XOR<restaurantsUpdateToOneWithWhereWithoutRestaurant_bidsInput, restaurantsUpdateWithoutRestaurant_bidsInput>, restaurantsUncheckedUpdateWithoutRestaurant_bidsInput>
  }

  export type usersUpdateOneRequiredWithoutRestaurant_bidsNestedInput = {
    create?: XOR<usersCreateWithoutRestaurant_bidsInput, usersUncheckedCreateWithoutRestaurant_bidsInput>
    connectOrCreate?: usersCreateOrConnectWithoutRestaurant_bidsInput
    upsert?: usersUpsertWithoutRestaurant_bidsInput
    connect?: usersWhereUniqueInput
    update?: XOR<XOR<usersUpdateToOneWithWhereWithoutRestaurant_bidsInput, usersUpdateWithoutRestaurant_bidsInput>, usersUncheckedUpdateWithoutRestaurant_bidsInput>
  }

  export type payoutsUncheckedUpdateManyWithoutRestaurant_bidsNestedInput = {
    create?: XOR<payoutsCreateWithoutRestaurant_bidsInput, payoutsUncheckedCreateWithoutRestaurant_bidsInput> | payoutsCreateWithoutRestaurant_bidsInput[] | payoutsUncheckedCreateWithoutRestaurant_bidsInput[]
    connectOrCreate?: payoutsCreateOrConnectWithoutRestaurant_bidsInput | payoutsCreateOrConnectWithoutRestaurant_bidsInput[]
    upsert?: payoutsUpsertWithWhereUniqueWithoutRestaurant_bidsInput | payoutsUpsertWithWhereUniqueWithoutRestaurant_bidsInput[]
    createMany?: payoutsCreateManyRestaurant_bidsInputEnvelope
    set?: payoutsWhereUniqueInput | payoutsWhereUniqueInput[]
    disconnect?: payoutsWhereUniqueInput | payoutsWhereUniqueInput[]
    delete?: payoutsWhereUniqueInput | payoutsWhereUniqueInput[]
    connect?: payoutsWhereUniqueInput | payoutsWhereUniqueInput[]
    update?: payoutsUpdateWithWhereUniqueWithoutRestaurant_bidsInput | payoutsUpdateWithWhereUniqueWithoutRestaurant_bidsInput[]
    updateMany?: payoutsUpdateManyWithWhereWithoutRestaurant_bidsInput | payoutsUpdateManyWithWhereWithoutRestaurant_bidsInput[]
    deleteMany?: payoutsScalarWhereInput | payoutsScalarWhereInput[]
  }

  export type dishesUpdateManyWithoutRestaurantsNestedInput = {
    create?: XOR<dishesCreateWithoutRestaurantsInput, dishesUncheckedCreateWithoutRestaurantsInput> | dishesCreateWithoutRestaurantsInput[] | dishesUncheckedCreateWithoutRestaurantsInput[]
    connectOrCreate?: dishesCreateOrConnectWithoutRestaurantsInput | dishesCreateOrConnectWithoutRestaurantsInput[]
    upsert?: dishesUpsertWithWhereUniqueWithoutRestaurantsInput | dishesUpsertWithWhereUniqueWithoutRestaurantsInput[]
    createMany?: dishesCreateManyRestaurantsInputEnvelope
    set?: dishesWhereUniqueInput | dishesWhereUniqueInput[]
    disconnect?: dishesWhereUniqueInput | dishesWhereUniqueInput[]
    delete?: dishesWhereUniqueInput | dishesWhereUniqueInput[]
    connect?: dishesWhereUniqueInput | dishesWhereUniqueInput[]
    update?: dishesUpdateWithWhereUniqueWithoutRestaurantsInput | dishesUpdateWithWhereUniqueWithoutRestaurantsInput[]
    updateMany?: dishesUpdateManyWithWhereWithoutRestaurantsInput | dishesUpdateManyWithWhereWithoutRestaurantsInput[]
    deleteMany?: dishesScalarWhereInput | dishesScalarWhereInput[]
  }

  export type restaurant_bidsUpdateManyWithoutRestaurantsNestedInput = {
    create?: XOR<restaurant_bidsCreateWithoutRestaurantsInput, restaurant_bidsUncheckedCreateWithoutRestaurantsInput> | restaurant_bidsCreateWithoutRestaurantsInput[] | restaurant_bidsUncheckedCreateWithoutRestaurantsInput[]
    connectOrCreate?: restaurant_bidsCreateOrConnectWithoutRestaurantsInput | restaurant_bidsCreateOrConnectWithoutRestaurantsInput[]
    upsert?: restaurant_bidsUpsertWithWhereUniqueWithoutRestaurantsInput | restaurant_bidsUpsertWithWhereUniqueWithoutRestaurantsInput[]
    createMany?: restaurant_bidsCreateManyRestaurantsInputEnvelope
    set?: restaurant_bidsWhereUniqueInput | restaurant_bidsWhereUniqueInput[]
    disconnect?: restaurant_bidsWhereUniqueInput | restaurant_bidsWhereUniqueInput[]
    delete?: restaurant_bidsWhereUniqueInput | restaurant_bidsWhereUniqueInput[]
    connect?: restaurant_bidsWhereUniqueInput | restaurant_bidsWhereUniqueInput[]
    update?: restaurant_bidsUpdateWithWhereUniqueWithoutRestaurantsInput | restaurant_bidsUpdateWithWhereUniqueWithoutRestaurantsInput[]
    updateMany?: restaurant_bidsUpdateManyWithWhereWithoutRestaurantsInput | restaurant_bidsUpdateManyWithWhereWithoutRestaurantsInput[]
    deleteMany?: restaurant_bidsScalarWhereInput | restaurant_bidsScalarWhereInput[]
  }

  export type dishesUncheckedUpdateManyWithoutRestaurantsNestedInput = {
    create?: XOR<dishesCreateWithoutRestaurantsInput, dishesUncheckedCreateWithoutRestaurantsInput> | dishesCreateWithoutRestaurantsInput[] | dishesUncheckedCreateWithoutRestaurantsInput[]
    connectOrCreate?: dishesCreateOrConnectWithoutRestaurantsInput | dishesCreateOrConnectWithoutRestaurantsInput[]
    upsert?: dishesUpsertWithWhereUniqueWithoutRestaurantsInput | dishesUpsertWithWhereUniqueWithoutRestaurantsInput[]
    createMany?: dishesCreateManyRestaurantsInputEnvelope
    set?: dishesWhereUniqueInput | dishesWhereUniqueInput[]
    disconnect?: dishesWhereUniqueInput | dishesWhereUniqueInput[]
    delete?: dishesWhereUniqueInput | dishesWhereUniqueInput[]
    connect?: dishesWhereUniqueInput | dishesWhereUniqueInput[]
    update?: dishesUpdateWithWhereUniqueWithoutRestaurantsInput | dishesUpdateWithWhereUniqueWithoutRestaurantsInput[]
    updateMany?: dishesUpdateManyWithWhereWithoutRestaurantsInput | dishesUpdateManyWithWhereWithoutRestaurantsInput[]
    deleteMany?: dishesScalarWhereInput | dishesScalarWhereInput[]
  }

  export type restaurant_bidsUncheckedUpdateManyWithoutRestaurantsNestedInput = {
    create?: XOR<restaurant_bidsCreateWithoutRestaurantsInput, restaurant_bidsUncheckedCreateWithoutRestaurantsInput> | restaurant_bidsCreateWithoutRestaurantsInput[] | restaurant_bidsUncheckedCreateWithoutRestaurantsInput[]
    connectOrCreate?: restaurant_bidsCreateOrConnectWithoutRestaurantsInput | restaurant_bidsCreateOrConnectWithoutRestaurantsInput[]
    upsert?: restaurant_bidsUpsertWithWhereUniqueWithoutRestaurantsInput | restaurant_bidsUpsertWithWhereUniqueWithoutRestaurantsInput[]
    createMany?: restaurant_bidsCreateManyRestaurantsInputEnvelope
    set?: restaurant_bidsWhereUniqueInput | restaurant_bidsWhereUniqueInput[]
    disconnect?: restaurant_bidsWhereUniqueInput | restaurant_bidsWhereUniqueInput[]
    delete?: restaurant_bidsWhereUniqueInput | restaurant_bidsWhereUniqueInput[]
    connect?: restaurant_bidsWhereUniqueInput | restaurant_bidsWhereUniqueInput[]
    update?: restaurant_bidsUpdateWithWhereUniqueWithoutRestaurantsInput | restaurant_bidsUpdateWithWhereUniqueWithoutRestaurantsInput[]
    updateMany?: restaurant_bidsUpdateManyWithWhereWithoutRestaurantsInput | restaurant_bidsUpdateManyWithWhereWithoutRestaurantsInput[]
    deleteMany?: restaurant_bidsScalarWhereInput | restaurant_bidsScalarWhereInput[]
  }

  export type dish_likesCreateNestedManyWithoutUsersInput = {
    create?: XOR<dish_likesCreateWithoutUsersInput, dish_likesUncheckedCreateWithoutUsersInput> | dish_likesCreateWithoutUsersInput[] | dish_likesUncheckedCreateWithoutUsersInput[]
    connectOrCreate?: dish_likesCreateOrConnectWithoutUsersInput | dish_likesCreateOrConnectWithoutUsersInput[]
    createMany?: dish_likesCreateManyUsersInputEnvelope
    connect?: dish_likesWhereUniqueInput | dish_likesWhereUniqueInput[]
  }

  export type dish_mediaCreateNestedManyWithoutUsersInput = {
    create?: XOR<dish_mediaCreateWithoutUsersInput, dish_mediaUncheckedCreateWithoutUsersInput> | dish_mediaCreateWithoutUsersInput[] | dish_mediaUncheckedCreateWithoutUsersInput[]
    connectOrCreate?: dish_mediaCreateOrConnectWithoutUsersInput | dish_mediaCreateOrConnectWithoutUsersInput[]
    createMany?: dish_mediaCreateManyUsersInputEnvelope
    connect?: dish_mediaWhereUniqueInput | dish_mediaWhereUniqueInput[]
  }

  export type dish_reviewsCreateNestedManyWithoutUsersInput = {
    create?: XOR<dish_reviewsCreateWithoutUsersInput, dish_reviewsUncheckedCreateWithoutUsersInput> | dish_reviewsCreateWithoutUsersInput[] | dish_reviewsUncheckedCreateWithoutUsersInput[]
    connectOrCreate?: dish_reviewsCreateOrConnectWithoutUsersInput | dish_reviewsCreateOrConnectWithoutUsersInput[]
    createMany?: dish_reviewsCreateManyUsersInputEnvelope
    connect?: dish_reviewsWhereUniqueInput | dish_reviewsWhereUniqueInput[]
  }

  export type restaurant_bidsCreateNestedManyWithoutUsersInput = {
    create?: XOR<restaurant_bidsCreateWithoutUsersInput, restaurant_bidsUncheckedCreateWithoutUsersInput> | restaurant_bidsCreateWithoutUsersInput[] | restaurant_bidsUncheckedCreateWithoutUsersInput[]
    connectOrCreate?: restaurant_bidsCreateOrConnectWithoutUsersInput | restaurant_bidsCreateOrConnectWithoutUsersInput[]
    createMany?: restaurant_bidsCreateManyUsersInputEnvelope
    connect?: restaurant_bidsWhereUniqueInput | restaurant_bidsWhereUniqueInput[]
  }

  export type dish_likesUncheckedCreateNestedManyWithoutUsersInput = {
    create?: XOR<dish_likesCreateWithoutUsersInput, dish_likesUncheckedCreateWithoutUsersInput> | dish_likesCreateWithoutUsersInput[] | dish_likesUncheckedCreateWithoutUsersInput[]
    connectOrCreate?: dish_likesCreateOrConnectWithoutUsersInput | dish_likesCreateOrConnectWithoutUsersInput[]
    createMany?: dish_likesCreateManyUsersInputEnvelope
    connect?: dish_likesWhereUniqueInput | dish_likesWhereUniqueInput[]
  }

  export type dish_mediaUncheckedCreateNestedManyWithoutUsersInput = {
    create?: XOR<dish_mediaCreateWithoutUsersInput, dish_mediaUncheckedCreateWithoutUsersInput> | dish_mediaCreateWithoutUsersInput[] | dish_mediaUncheckedCreateWithoutUsersInput[]
    connectOrCreate?: dish_mediaCreateOrConnectWithoutUsersInput | dish_mediaCreateOrConnectWithoutUsersInput[]
    createMany?: dish_mediaCreateManyUsersInputEnvelope
    connect?: dish_mediaWhereUniqueInput | dish_mediaWhereUniqueInput[]
  }

  export type dish_reviewsUncheckedCreateNestedManyWithoutUsersInput = {
    create?: XOR<dish_reviewsCreateWithoutUsersInput, dish_reviewsUncheckedCreateWithoutUsersInput> | dish_reviewsCreateWithoutUsersInput[] | dish_reviewsUncheckedCreateWithoutUsersInput[]
    connectOrCreate?: dish_reviewsCreateOrConnectWithoutUsersInput | dish_reviewsCreateOrConnectWithoutUsersInput[]
    createMany?: dish_reviewsCreateManyUsersInputEnvelope
    connect?: dish_reviewsWhereUniqueInput | dish_reviewsWhereUniqueInput[]
  }

  export type restaurant_bidsUncheckedCreateNestedManyWithoutUsersInput = {
    create?: XOR<restaurant_bidsCreateWithoutUsersInput, restaurant_bidsUncheckedCreateWithoutUsersInput> | restaurant_bidsCreateWithoutUsersInput[] | restaurant_bidsUncheckedCreateWithoutUsersInput[]
    connectOrCreate?: restaurant_bidsCreateOrConnectWithoutUsersInput | restaurant_bidsCreateOrConnectWithoutUsersInput[]
    createMany?: restaurant_bidsCreateManyUsersInputEnvelope
    connect?: restaurant_bidsWhereUniqueInput | restaurant_bidsWhereUniqueInput[]
  }

  export type NullableDateTimeFieldUpdateOperationsInput = {
    set?: Date | string | null
  }

  export type dish_likesUpdateManyWithoutUsersNestedInput = {
    create?: XOR<dish_likesCreateWithoutUsersInput, dish_likesUncheckedCreateWithoutUsersInput> | dish_likesCreateWithoutUsersInput[] | dish_likesUncheckedCreateWithoutUsersInput[]
    connectOrCreate?: dish_likesCreateOrConnectWithoutUsersInput | dish_likesCreateOrConnectWithoutUsersInput[]
    upsert?: dish_likesUpsertWithWhereUniqueWithoutUsersInput | dish_likesUpsertWithWhereUniqueWithoutUsersInput[]
    createMany?: dish_likesCreateManyUsersInputEnvelope
    set?: dish_likesWhereUniqueInput | dish_likesWhereUniqueInput[]
    disconnect?: dish_likesWhereUniqueInput | dish_likesWhereUniqueInput[]
    delete?: dish_likesWhereUniqueInput | dish_likesWhereUniqueInput[]
    connect?: dish_likesWhereUniqueInput | dish_likesWhereUniqueInput[]
    update?: dish_likesUpdateWithWhereUniqueWithoutUsersInput | dish_likesUpdateWithWhereUniqueWithoutUsersInput[]
    updateMany?: dish_likesUpdateManyWithWhereWithoutUsersInput | dish_likesUpdateManyWithWhereWithoutUsersInput[]
    deleteMany?: dish_likesScalarWhereInput | dish_likesScalarWhereInput[]
  }

  export type dish_mediaUpdateManyWithoutUsersNestedInput = {
    create?: XOR<dish_mediaCreateWithoutUsersInput, dish_mediaUncheckedCreateWithoutUsersInput> | dish_mediaCreateWithoutUsersInput[] | dish_mediaUncheckedCreateWithoutUsersInput[]
    connectOrCreate?: dish_mediaCreateOrConnectWithoutUsersInput | dish_mediaCreateOrConnectWithoutUsersInput[]
    upsert?: dish_mediaUpsertWithWhereUniqueWithoutUsersInput | dish_mediaUpsertWithWhereUniqueWithoutUsersInput[]
    createMany?: dish_mediaCreateManyUsersInputEnvelope
    set?: dish_mediaWhereUniqueInput | dish_mediaWhereUniqueInput[]
    disconnect?: dish_mediaWhereUniqueInput | dish_mediaWhereUniqueInput[]
    delete?: dish_mediaWhereUniqueInput | dish_mediaWhereUniqueInput[]
    connect?: dish_mediaWhereUniqueInput | dish_mediaWhereUniqueInput[]
    update?: dish_mediaUpdateWithWhereUniqueWithoutUsersInput | dish_mediaUpdateWithWhereUniqueWithoutUsersInput[]
    updateMany?: dish_mediaUpdateManyWithWhereWithoutUsersInput | dish_mediaUpdateManyWithWhereWithoutUsersInput[]
    deleteMany?: dish_mediaScalarWhereInput | dish_mediaScalarWhereInput[]
  }

  export type dish_reviewsUpdateManyWithoutUsersNestedInput = {
    create?: XOR<dish_reviewsCreateWithoutUsersInput, dish_reviewsUncheckedCreateWithoutUsersInput> | dish_reviewsCreateWithoutUsersInput[] | dish_reviewsUncheckedCreateWithoutUsersInput[]
    connectOrCreate?: dish_reviewsCreateOrConnectWithoutUsersInput | dish_reviewsCreateOrConnectWithoutUsersInput[]
    upsert?: dish_reviewsUpsertWithWhereUniqueWithoutUsersInput | dish_reviewsUpsertWithWhereUniqueWithoutUsersInput[]
    createMany?: dish_reviewsCreateManyUsersInputEnvelope
    set?: dish_reviewsWhereUniqueInput | dish_reviewsWhereUniqueInput[]
    disconnect?: dish_reviewsWhereUniqueInput | dish_reviewsWhereUniqueInput[]
    delete?: dish_reviewsWhereUniqueInput | dish_reviewsWhereUniqueInput[]
    connect?: dish_reviewsWhereUniqueInput | dish_reviewsWhereUniqueInput[]
    update?: dish_reviewsUpdateWithWhereUniqueWithoutUsersInput | dish_reviewsUpdateWithWhereUniqueWithoutUsersInput[]
    updateMany?: dish_reviewsUpdateManyWithWhereWithoutUsersInput | dish_reviewsUpdateManyWithWhereWithoutUsersInput[]
    deleteMany?: dish_reviewsScalarWhereInput | dish_reviewsScalarWhereInput[]
  }

  export type restaurant_bidsUpdateManyWithoutUsersNestedInput = {
    create?: XOR<restaurant_bidsCreateWithoutUsersInput, restaurant_bidsUncheckedCreateWithoutUsersInput> | restaurant_bidsCreateWithoutUsersInput[] | restaurant_bidsUncheckedCreateWithoutUsersInput[]
    connectOrCreate?: restaurant_bidsCreateOrConnectWithoutUsersInput | restaurant_bidsCreateOrConnectWithoutUsersInput[]
    upsert?: restaurant_bidsUpsertWithWhereUniqueWithoutUsersInput | restaurant_bidsUpsertWithWhereUniqueWithoutUsersInput[]
    createMany?: restaurant_bidsCreateManyUsersInputEnvelope
    set?: restaurant_bidsWhereUniqueInput | restaurant_bidsWhereUniqueInput[]
    disconnect?: restaurant_bidsWhereUniqueInput | restaurant_bidsWhereUniqueInput[]
    delete?: restaurant_bidsWhereUniqueInput | restaurant_bidsWhereUniqueInput[]
    connect?: restaurant_bidsWhereUniqueInput | restaurant_bidsWhereUniqueInput[]
    update?: restaurant_bidsUpdateWithWhereUniqueWithoutUsersInput | restaurant_bidsUpdateWithWhereUniqueWithoutUsersInput[]
    updateMany?: restaurant_bidsUpdateManyWithWhereWithoutUsersInput | restaurant_bidsUpdateManyWithWhereWithoutUsersInput[]
    deleteMany?: restaurant_bidsScalarWhereInput | restaurant_bidsScalarWhereInput[]
  }

  export type dish_likesUncheckedUpdateManyWithoutUsersNestedInput = {
    create?: XOR<dish_likesCreateWithoutUsersInput, dish_likesUncheckedCreateWithoutUsersInput> | dish_likesCreateWithoutUsersInput[] | dish_likesUncheckedCreateWithoutUsersInput[]
    connectOrCreate?: dish_likesCreateOrConnectWithoutUsersInput | dish_likesCreateOrConnectWithoutUsersInput[]
    upsert?: dish_likesUpsertWithWhereUniqueWithoutUsersInput | dish_likesUpsertWithWhereUniqueWithoutUsersInput[]
    createMany?: dish_likesCreateManyUsersInputEnvelope
    set?: dish_likesWhereUniqueInput | dish_likesWhereUniqueInput[]
    disconnect?: dish_likesWhereUniqueInput | dish_likesWhereUniqueInput[]
    delete?: dish_likesWhereUniqueInput | dish_likesWhereUniqueInput[]
    connect?: dish_likesWhereUniqueInput | dish_likesWhereUniqueInput[]
    update?: dish_likesUpdateWithWhereUniqueWithoutUsersInput | dish_likesUpdateWithWhereUniqueWithoutUsersInput[]
    updateMany?: dish_likesUpdateManyWithWhereWithoutUsersInput | dish_likesUpdateManyWithWhereWithoutUsersInput[]
    deleteMany?: dish_likesScalarWhereInput | dish_likesScalarWhereInput[]
  }

  export type dish_mediaUncheckedUpdateManyWithoutUsersNestedInput = {
    create?: XOR<dish_mediaCreateWithoutUsersInput, dish_mediaUncheckedCreateWithoutUsersInput> | dish_mediaCreateWithoutUsersInput[] | dish_mediaUncheckedCreateWithoutUsersInput[]
    connectOrCreate?: dish_mediaCreateOrConnectWithoutUsersInput | dish_mediaCreateOrConnectWithoutUsersInput[]
    upsert?: dish_mediaUpsertWithWhereUniqueWithoutUsersInput | dish_mediaUpsertWithWhereUniqueWithoutUsersInput[]
    createMany?: dish_mediaCreateManyUsersInputEnvelope
    set?: dish_mediaWhereUniqueInput | dish_mediaWhereUniqueInput[]
    disconnect?: dish_mediaWhereUniqueInput | dish_mediaWhereUniqueInput[]
    delete?: dish_mediaWhereUniqueInput | dish_mediaWhereUniqueInput[]
    connect?: dish_mediaWhereUniqueInput | dish_mediaWhereUniqueInput[]
    update?: dish_mediaUpdateWithWhereUniqueWithoutUsersInput | dish_mediaUpdateWithWhereUniqueWithoutUsersInput[]
    updateMany?: dish_mediaUpdateManyWithWhereWithoutUsersInput | dish_mediaUpdateManyWithWhereWithoutUsersInput[]
    deleteMany?: dish_mediaScalarWhereInput | dish_mediaScalarWhereInput[]
  }

  export type dish_reviewsUncheckedUpdateManyWithoutUsersNestedInput = {
    create?: XOR<dish_reviewsCreateWithoutUsersInput, dish_reviewsUncheckedCreateWithoutUsersInput> | dish_reviewsCreateWithoutUsersInput[] | dish_reviewsUncheckedCreateWithoutUsersInput[]
    connectOrCreate?: dish_reviewsCreateOrConnectWithoutUsersInput | dish_reviewsCreateOrConnectWithoutUsersInput[]
    upsert?: dish_reviewsUpsertWithWhereUniqueWithoutUsersInput | dish_reviewsUpsertWithWhereUniqueWithoutUsersInput[]
    createMany?: dish_reviewsCreateManyUsersInputEnvelope
    set?: dish_reviewsWhereUniqueInput | dish_reviewsWhereUniqueInput[]
    disconnect?: dish_reviewsWhereUniqueInput | dish_reviewsWhereUniqueInput[]
    delete?: dish_reviewsWhereUniqueInput | dish_reviewsWhereUniqueInput[]
    connect?: dish_reviewsWhereUniqueInput | dish_reviewsWhereUniqueInput[]
    update?: dish_reviewsUpdateWithWhereUniqueWithoutUsersInput | dish_reviewsUpdateWithWhereUniqueWithoutUsersInput[]
    updateMany?: dish_reviewsUpdateManyWithWhereWithoutUsersInput | dish_reviewsUpdateManyWithWhereWithoutUsersInput[]
    deleteMany?: dish_reviewsScalarWhereInput | dish_reviewsScalarWhereInput[]
  }

  export type restaurant_bidsUncheckedUpdateManyWithoutUsersNestedInput = {
    create?: XOR<restaurant_bidsCreateWithoutUsersInput, restaurant_bidsUncheckedCreateWithoutUsersInput> | restaurant_bidsCreateWithoutUsersInput[] | restaurant_bidsUncheckedCreateWithoutUsersInput[]
    connectOrCreate?: restaurant_bidsCreateOrConnectWithoutUsersInput | restaurant_bidsCreateOrConnectWithoutUsersInput[]
    upsert?: restaurant_bidsUpsertWithWhereUniqueWithoutUsersInput | restaurant_bidsUpsertWithWhereUniqueWithoutUsersInput[]
    createMany?: restaurant_bidsCreateManyUsersInputEnvelope
    set?: restaurant_bidsWhereUniqueInput | restaurant_bidsWhereUniqueInput[]
    disconnect?: restaurant_bidsWhereUniqueInput | restaurant_bidsWhereUniqueInput[]
    delete?: restaurant_bidsWhereUniqueInput | restaurant_bidsWhereUniqueInput[]
    connect?: restaurant_bidsWhereUniqueInput | restaurant_bidsWhereUniqueInput[]
    update?: restaurant_bidsUpdateWithWhereUniqueWithoutUsersInput | restaurant_bidsUpdateWithWhereUniqueWithoutUsersInput[]
    updateMany?: restaurant_bidsUpdateManyWithWhereWithoutUsersInput | restaurant_bidsUpdateManyWithWhereWithoutUsersInput[]
    deleteMany?: restaurant_bidsScalarWhereInput | restaurant_bidsScalarWhereInput[]
  }

  export type NestedStringFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringFilter<$PrismaModel> | string
  }

  export type NestedDateTimeFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeFilter<$PrismaModel> | Date | string
  }

  export type NestedIntFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntFilter<$PrismaModel> | number
  }

  export type NestedStringWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringWithAggregatesFilter<$PrismaModel> | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedStringFilter<$PrismaModel>
    _max?: NestedStringFilter<$PrismaModel>
  }
  export type NestedJsonFilter<$PrismaModel = never> =
    | PatchUndefined<
        Either<Required<NestedJsonFilterBase<$PrismaModel>>, Exclude<keyof Required<NestedJsonFilterBase<$PrismaModel>>, 'path'>>,
        Required<NestedJsonFilterBase<$PrismaModel>>
      >
    | OptionalFlat<Omit<Required<NestedJsonFilterBase<$PrismaModel>>, 'path'>>

  export type NestedJsonFilterBase<$PrismaModel = never> = {
    equals?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    path?: string[]
    mode?: QueryMode | EnumQueryModeFieldRefInput<$PrismaModel>
    string_contains?: string | StringFieldRefInput<$PrismaModel>
    string_starts_with?: string | StringFieldRefInput<$PrismaModel>
    string_ends_with?: string | StringFieldRefInput<$PrismaModel>
    array_starts_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_ends_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_contains?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    lt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    lte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    not?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
  }

  export type NestedDateTimeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeWithAggregatesFilter<$PrismaModel> | Date | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedDateTimeFilter<$PrismaModel>
    _max?: NestedDateTimeFilter<$PrismaModel>
  }

  export type NestedIntWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedIntFilter<$PrismaModel>
    _min?: NestedIntFilter<$PrismaModel>
    _max?: NestedIntFilter<$PrismaModel>
  }

  export type NestedFloatFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel>
    in?: number[] | ListFloatFieldRefInput<$PrismaModel>
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel>
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatFilter<$PrismaModel> | number
  }

  export type NestedUuidFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedUuidFilter<$PrismaModel> | string
  }

  export type NestedStringNullableFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringNullableFilter<$PrismaModel> | string | null
  }

  export type NestedUuidWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedUuidWithAggregatesFilter<$PrismaModel> | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedStringFilter<$PrismaModel>
    _max?: NestedStringFilter<$PrismaModel>
  }

  export type NestedStringNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringNullableWithAggregatesFilter<$PrismaModel> | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedStringNullableFilter<$PrismaModel>
    _max?: NestedStringNullableFilter<$PrismaModel>
  }

  export type NestedIntNullableFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableFilter<$PrismaModel> | number | null
  }

  export type NestedUuidNullableFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedUuidNullableFilter<$PrismaModel> | string | null
  }

  export type NestedUuidNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedUuidNullableWithAggregatesFilter<$PrismaModel> | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedStringNullableFilter<$PrismaModel>
    _max?: NestedStringNullableFilter<$PrismaModel>
  }

  export type NestedIntNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableWithAggregatesFilter<$PrismaModel> | number | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _avg?: NestedFloatNullableFilter<$PrismaModel>
    _sum?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedIntNullableFilter<$PrismaModel>
    _max?: NestedIntNullableFilter<$PrismaModel>
  }

  export type NestedFloatNullableFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel> | null
    in?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatNullableFilter<$PrismaModel> | number | null
  }

  export type NestedBigIntFilter<$PrismaModel = never> = {
    equals?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    in?: bigint[] | number[] | ListBigIntFieldRefInput<$PrismaModel>
    notIn?: bigint[] | number[] | ListBigIntFieldRefInput<$PrismaModel>
    lt?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    lte?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    gt?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    gte?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    not?: NestedBigIntFilter<$PrismaModel> | bigint | number
  }

  export type NestedEnumpayout_statusFilter<$PrismaModel = never> = {
    equals?: $Enums.payout_status | Enumpayout_statusFieldRefInput<$PrismaModel>
    in?: $Enums.payout_status[] | ListEnumpayout_statusFieldRefInput<$PrismaModel>
    notIn?: $Enums.payout_status[] | ListEnumpayout_statusFieldRefInput<$PrismaModel>
    not?: NestedEnumpayout_statusFilter<$PrismaModel> | $Enums.payout_status
  }

  export type NestedBigIntWithAggregatesFilter<$PrismaModel = never> = {
    equals?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    in?: bigint[] | number[] | ListBigIntFieldRefInput<$PrismaModel>
    notIn?: bigint[] | number[] | ListBigIntFieldRefInput<$PrismaModel>
    lt?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    lte?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    gt?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    gte?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    not?: NestedBigIntWithAggregatesFilter<$PrismaModel> | bigint | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedBigIntFilter<$PrismaModel>
    _min?: NestedBigIntFilter<$PrismaModel>
    _max?: NestedBigIntFilter<$PrismaModel>
  }

  export type NestedEnumpayout_statusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.payout_status | Enumpayout_statusFieldRefInput<$PrismaModel>
    in?: $Enums.payout_status[] | ListEnumpayout_statusFieldRefInput<$PrismaModel>
    notIn?: $Enums.payout_status[] | ListEnumpayout_statusFieldRefInput<$PrismaModel>
    not?: NestedEnumpayout_statusWithAggregatesFilter<$PrismaModel> | $Enums.payout_status
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumpayout_statusFilter<$PrismaModel>
    _max?: NestedEnumpayout_statusFilter<$PrismaModel>
  }

  export type NestedEnumrestaurant_bid_statusFilter<$PrismaModel = never> = {
    equals?: $Enums.restaurant_bid_status | Enumrestaurant_bid_statusFieldRefInput<$PrismaModel>
    in?: $Enums.restaurant_bid_status[] | ListEnumrestaurant_bid_statusFieldRefInput<$PrismaModel>
    notIn?: $Enums.restaurant_bid_status[] | ListEnumrestaurant_bid_statusFieldRefInput<$PrismaModel>
    not?: NestedEnumrestaurant_bid_statusFilter<$PrismaModel> | $Enums.restaurant_bid_status
  }

  export type NestedEnumrestaurant_bid_statusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.restaurant_bid_status | Enumrestaurant_bid_statusFieldRefInput<$PrismaModel>
    in?: $Enums.restaurant_bid_status[] | ListEnumrestaurant_bid_statusFieldRefInput<$PrismaModel>
    notIn?: $Enums.restaurant_bid_status[] | ListEnumrestaurant_bid_statusFieldRefInput<$PrismaModel>
    not?: NestedEnumrestaurant_bid_statusWithAggregatesFilter<$PrismaModel> | $Enums.restaurant_bid_status
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumrestaurant_bid_statusFilter<$PrismaModel>
    _max?: NestedEnumrestaurant_bid_statusFilter<$PrismaModel>
  }

  export type NestedDateTimeNullableFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableFilter<$PrismaModel> | Date | string | null
  }

  export type NestedDateTimeNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableWithAggregatesFilter<$PrismaModel> | Date | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedDateTimeNullableFilter<$PrismaModel>
    _max?: NestedDateTimeNullableFilter<$PrismaModel>
  }

  export type dish_category_variantsCreateWithoutDish_categoriesInput = {
    id?: string
    surface_form: string
    source?: string | null
    created_at?: Date | string
  }

  export type dish_category_variantsUncheckedCreateWithoutDish_categoriesInput = {
    id?: string
    surface_form: string
    source?: string | null
    created_at?: Date | string
  }

  export type dish_category_variantsCreateOrConnectWithoutDish_categoriesInput = {
    where: dish_category_variantsWhereUniqueInput
    create: XOR<dish_category_variantsCreateWithoutDish_categoriesInput, dish_category_variantsUncheckedCreateWithoutDish_categoriesInput>
  }

  export type dish_category_variantsCreateManyDish_categoriesInputEnvelope = {
    data: dish_category_variantsCreateManyDish_categoriesInput | dish_category_variantsCreateManyDish_categoriesInput[]
    skipDuplicates?: boolean
  }

  export type dishesCreateWithoutDish_categoriesInput = {
    id?: string
    name?: string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    dish_media?: dish_mediaCreateNestedManyWithoutDishesInput
    dish_reviews?: dish_reviewsCreateNestedManyWithoutDishesInput
    restaurants?: restaurantsCreateNestedOneWithoutDishesInput
  }

  export type dishesUncheckedCreateWithoutDish_categoriesInput = {
    id?: string
    restaurant_id?: string | null
    name?: string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    dish_media?: dish_mediaUncheckedCreateNestedManyWithoutDishesInput
    dish_reviews?: dish_reviewsUncheckedCreateNestedManyWithoutDishesInput
  }

  export type dishesCreateOrConnectWithoutDish_categoriesInput = {
    where: dishesWhereUniqueInput
    create: XOR<dishesCreateWithoutDish_categoriesInput, dishesUncheckedCreateWithoutDish_categoriesInput>
  }

  export type dishesCreateManyDish_categoriesInputEnvelope = {
    data: dishesCreateManyDish_categoriesInput | dishesCreateManyDish_categoriesInput[]
    skipDuplicates?: boolean
  }

  export type dish_category_variantsUpsertWithWhereUniqueWithoutDish_categoriesInput = {
    where: dish_category_variantsWhereUniqueInput
    update: XOR<dish_category_variantsUpdateWithoutDish_categoriesInput, dish_category_variantsUncheckedUpdateWithoutDish_categoriesInput>
    create: XOR<dish_category_variantsCreateWithoutDish_categoriesInput, dish_category_variantsUncheckedCreateWithoutDish_categoriesInput>
  }

  export type dish_category_variantsUpdateWithWhereUniqueWithoutDish_categoriesInput = {
    where: dish_category_variantsWhereUniqueInput
    data: XOR<dish_category_variantsUpdateWithoutDish_categoriesInput, dish_category_variantsUncheckedUpdateWithoutDish_categoriesInput>
  }

  export type dish_category_variantsUpdateManyWithWhereWithoutDish_categoriesInput = {
    where: dish_category_variantsScalarWhereInput
    data: XOR<dish_category_variantsUpdateManyMutationInput, dish_category_variantsUncheckedUpdateManyWithoutDish_categoriesInput>
  }

  export type dish_category_variantsScalarWhereInput = {
    AND?: dish_category_variantsScalarWhereInput | dish_category_variantsScalarWhereInput[]
    OR?: dish_category_variantsScalarWhereInput[]
    NOT?: dish_category_variantsScalarWhereInput | dish_category_variantsScalarWhereInput[]
    id?: UuidFilter<"dish_category_variants"> | string
    dish_category_id?: StringFilter<"dish_category_variants"> | string
    surface_form?: StringFilter<"dish_category_variants"> | string
    source?: StringNullableFilter<"dish_category_variants"> | string | null
    created_at?: DateTimeFilter<"dish_category_variants"> | Date | string
  }

  export type dishesUpsertWithWhereUniqueWithoutDish_categoriesInput = {
    where: dishesWhereUniqueInput
    update: XOR<dishesUpdateWithoutDish_categoriesInput, dishesUncheckedUpdateWithoutDish_categoriesInput>
    create: XOR<dishesCreateWithoutDish_categoriesInput, dishesUncheckedCreateWithoutDish_categoriesInput>
  }

  export type dishesUpdateWithWhereUniqueWithoutDish_categoriesInput = {
    where: dishesWhereUniqueInput
    data: XOR<dishesUpdateWithoutDish_categoriesInput, dishesUncheckedUpdateWithoutDish_categoriesInput>
  }

  export type dishesUpdateManyWithWhereWithoutDish_categoriesInput = {
    where: dishesScalarWhereInput
    data: XOR<dishesUpdateManyMutationInput, dishesUncheckedUpdateManyWithoutDish_categoriesInput>
  }

  export type dishesScalarWhereInput = {
    AND?: dishesScalarWhereInput | dishesScalarWhereInput[]
    OR?: dishesScalarWhereInput[]
    NOT?: dishesScalarWhereInput | dishesScalarWhereInput[]
    id?: UuidFilter<"dishes"> | string
    restaurant_id?: UuidNullableFilter<"dishes"> | string | null
    category_id?: StringFilter<"dishes"> | string
    name?: StringNullableFilter<"dishes"> | string | null
    created_at?: DateTimeFilter<"dishes"> | Date | string
    updated_at?: DateTimeFilter<"dishes"> | Date | string
    lock_no?: IntFilter<"dishes"> | number
  }

  export type dish_categoriesCreateWithoutDish_category_variantsInput = {
    id: string
    label_en: string
    labels: JsonNullValueInput | InputJsonValue
    image_url: string
    origin?: dish_categoriesCreateoriginInput | string[]
    cuisine?: dish_categoriesCreatecuisineInput | string[]
    tags?: dish_categoriesCreatetagsInput | string[]
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    dishes?: dishesCreateNestedManyWithoutDish_categoriesInput
  }

  export type dish_categoriesUncheckedCreateWithoutDish_category_variantsInput = {
    id: string
    label_en: string
    labels: JsonNullValueInput | InputJsonValue
    image_url: string
    origin?: dish_categoriesCreateoriginInput | string[]
    cuisine?: dish_categoriesCreatecuisineInput | string[]
    tags?: dish_categoriesCreatetagsInput | string[]
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    dishes?: dishesUncheckedCreateNestedManyWithoutDish_categoriesInput
  }

  export type dish_categoriesCreateOrConnectWithoutDish_category_variantsInput = {
    where: dish_categoriesWhereUniqueInput
    create: XOR<dish_categoriesCreateWithoutDish_category_variantsInput, dish_categoriesUncheckedCreateWithoutDish_category_variantsInput>
  }

  export type dish_categoriesUpsertWithoutDish_category_variantsInput = {
    update: XOR<dish_categoriesUpdateWithoutDish_category_variantsInput, dish_categoriesUncheckedUpdateWithoutDish_category_variantsInput>
    create: XOR<dish_categoriesCreateWithoutDish_category_variantsInput, dish_categoriesUncheckedCreateWithoutDish_category_variantsInput>
    where?: dish_categoriesWhereInput
  }

  export type dish_categoriesUpdateToOneWithWhereWithoutDish_category_variantsInput = {
    where?: dish_categoriesWhereInput
    data: XOR<dish_categoriesUpdateWithoutDish_category_variantsInput, dish_categoriesUncheckedUpdateWithoutDish_category_variantsInput>
  }

  export type dish_categoriesUpdateWithoutDish_category_variantsInput = {
    id?: StringFieldUpdateOperationsInput | string
    label_en?: StringFieldUpdateOperationsInput | string
    labels?: JsonNullValueInput | InputJsonValue
    image_url?: StringFieldUpdateOperationsInput | string
    origin?: dish_categoriesUpdateoriginInput | string[]
    cuisine?: dish_categoriesUpdatecuisineInput | string[]
    tags?: dish_categoriesUpdatetagsInput | string[]
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    dishes?: dishesUpdateManyWithoutDish_categoriesNestedInput
  }

  export type dish_categoriesUncheckedUpdateWithoutDish_category_variantsInput = {
    id?: StringFieldUpdateOperationsInput | string
    label_en?: StringFieldUpdateOperationsInput | string
    labels?: JsonNullValueInput | InputJsonValue
    image_url?: StringFieldUpdateOperationsInput | string
    origin?: dish_categoriesUpdateoriginInput | string[]
    cuisine?: dish_categoriesUpdatecuisineInput | string[]
    tags?: dish_categoriesUpdatetagsInput | string[]
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    dishes?: dishesUncheckedUpdateManyWithoutDish_categoriesNestedInput
  }

  export type dish_mediaCreateWithoutDish_likesInput = {
    id?: string
    media_path: string
    media_type: string
    thumbnail_path?: string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    dishes: dishesCreateNestedOneWithoutDish_mediaInput
    users?: usersCreateNestedOneWithoutDish_mediaInput
    payouts?: payoutsCreateNestedManyWithoutDish_mediaInput
  }

  export type dish_mediaUncheckedCreateWithoutDish_likesInput = {
    id?: string
    dish_id: string
    user_id?: string | null
    media_path: string
    media_type: string
    thumbnail_path?: string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    payouts?: payoutsUncheckedCreateNestedManyWithoutDish_mediaInput
  }

  export type dish_mediaCreateOrConnectWithoutDish_likesInput = {
    where: dish_mediaWhereUniqueInput
    create: XOR<dish_mediaCreateWithoutDish_likesInput, dish_mediaUncheckedCreateWithoutDish_likesInput>
  }

  export type usersCreateWithoutDish_likesInput = {
    id?: string
    username: string
    display_name?: string | null
    avatar?: string | null
    bio?: string | null
    last_login_at?: Date | string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    dish_media?: dish_mediaCreateNestedManyWithoutUsersInput
    dish_reviews?: dish_reviewsCreateNestedManyWithoutUsersInput
    restaurant_bids?: restaurant_bidsCreateNestedManyWithoutUsersInput
  }

  export type usersUncheckedCreateWithoutDish_likesInput = {
    id?: string
    username: string
    display_name?: string | null
    avatar?: string | null
    bio?: string | null
    last_login_at?: Date | string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    dish_media?: dish_mediaUncheckedCreateNestedManyWithoutUsersInput
    dish_reviews?: dish_reviewsUncheckedCreateNestedManyWithoutUsersInput
    restaurant_bids?: restaurant_bidsUncheckedCreateNestedManyWithoutUsersInput
  }

  export type usersCreateOrConnectWithoutDish_likesInput = {
    where: usersWhereUniqueInput
    create: XOR<usersCreateWithoutDish_likesInput, usersUncheckedCreateWithoutDish_likesInput>
  }

  export type dish_mediaUpsertWithoutDish_likesInput = {
    update: XOR<dish_mediaUpdateWithoutDish_likesInput, dish_mediaUncheckedUpdateWithoutDish_likesInput>
    create: XOR<dish_mediaCreateWithoutDish_likesInput, dish_mediaUncheckedCreateWithoutDish_likesInput>
    where?: dish_mediaWhereInput
  }

  export type dish_mediaUpdateToOneWithWhereWithoutDish_likesInput = {
    where?: dish_mediaWhereInput
    data: XOR<dish_mediaUpdateWithoutDish_likesInput, dish_mediaUncheckedUpdateWithoutDish_likesInput>
  }

  export type dish_mediaUpdateWithoutDish_likesInput = {
    id?: StringFieldUpdateOperationsInput | string
    media_path?: StringFieldUpdateOperationsInput | string
    media_type?: StringFieldUpdateOperationsInput | string
    thumbnail_path?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    dishes?: dishesUpdateOneRequiredWithoutDish_mediaNestedInput
    users?: usersUpdateOneWithoutDish_mediaNestedInput
    payouts?: payoutsUpdateManyWithoutDish_mediaNestedInput
  }

  export type dish_mediaUncheckedUpdateWithoutDish_likesInput = {
    id?: StringFieldUpdateOperationsInput | string
    dish_id?: StringFieldUpdateOperationsInput | string
    user_id?: NullableStringFieldUpdateOperationsInput | string | null
    media_path?: StringFieldUpdateOperationsInput | string
    media_type?: StringFieldUpdateOperationsInput | string
    thumbnail_path?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    payouts?: payoutsUncheckedUpdateManyWithoutDish_mediaNestedInput
  }

  export type usersUpsertWithoutDish_likesInput = {
    update: XOR<usersUpdateWithoutDish_likesInput, usersUncheckedUpdateWithoutDish_likesInput>
    create: XOR<usersCreateWithoutDish_likesInput, usersUncheckedCreateWithoutDish_likesInput>
    where?: usersWhereInput
  }

  export type usersUpdateToOneWithWhereWithoutDish_likesInput = {
    where?: usersWhereInput
    data: XOR<usersUpdateWithoutDish_likesInput, usersUncheckedUpdateWithoutDish_likesInput>
  }

  export type usersUpdateWithoutDish_likesInput = {
    id?: StringFieldUpdateOperationsInput | string
    username?: StringFieldUpdateOperationsInput | string
    display_name?: NullableStringFieldUpdateOperationsInput | string | null
    avatar?: NullableStringFieldUpdateOperationsInput | string | null
    bio?: NullableStringFieldUpdateOperationsInput | string | null
    last_login_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    dish_media?: dish_mediaUpdateManyWithoutUsersNestedInput
    dish_reviews?: dish_reviewsUpdateManyWithoutUsersNestedInput
    restaurant_bids?: restaurant_bidsUpdateManyWithoutUsersNestedInput
  }

  export type usersUncheckedUpdateWithoutDish_likesInput = {
    id?: StringFieldUpdateOperationsInput | string
    username?: StringFieldUpdateOperationsInput | string
    display_name?: NullableStringFieldUpdateOperationsInput | string | null
    avatar?: NullableStringFieldUpdateOperationsInput | string | null
    bio?: NullableStringFieldUpdateOperationsInput | string | null
    last_login_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    dish_media?: dish_mediaUncheckedUpdateManyWithoutUsersNestedInput
    dish_reviews?: dish_reviewsUncheckedUpdateManyWithoutUsersNestedInput
    restaurant_bids?: restaurant_bidsUncheckedUpdateManyWithoutUsersNestedInput
  }

  export type dish_likesCreateWithoutDish_mediaInput = {
    id?: string
    created_at?: Date | string
    users: usersCreateNestedOneWithoutDish_likesInput
  }

  export type dish_likesUncheckedCreateWithoutDish_mediaInput = {
    id?: string
    user_id: string
    created_at?: Date | string
  }

  export type dish_likesCreateOrConnectWithoutDish_mediaInput = {
    where: dish_likesWhereUniqueInput
    create: XOR<dish_likesCreateWithoutDish_mediaInput, dish_likesUncheckedCreateWithoutDish_mediaInput>
  }

  export type dish_likesCreateManyDish_mediaInputEnvelope = {
    data: dish_likesCreateManyDish_mediaInput | dish_likesCreateManyDish_mediaInput[]
    skipDuplicates?: boolean
  }

  export type dishesCreateWithoutDish_mediaInput = {
    id?: string
    name?: string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    dish_reviews?: dish_reviewsCreateNestedManyWithoutDishesInput
    dish_categories: dish_categoriesCreateNestedOneWithoutDishesInput
    restaurants?: restaurantsCreateNestedOneWithoutDishesInput
  }

  export type dishesUncheckedCreateWithoutDish_mediaInput = {
    id?: string
    restaurant_id?: string | null
    category_id: string
    name?: string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    dish_reviews?: dish_reviewsUncheckedCreateNestedManyWithoutDishesInput
  }

  export type dishesCreateOrConnectWithoutDish_mediaInput = {
    where: dishesWhereUniqueInput
    create: XOR<dishesCreateWithoutDish_mediaInput, dishesUncheckedCreateWithoutDish_mediaInput>
  }

  export type usersCreateWithoutDish_mediaInput = {
    id?: string
    username: string
    display_name?: string | null
    avatar?: string | null
    bio?: string | null
    last_login_at?: Date | string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    dish_likes?: dish_likesCreateNestedManyWithoutUsersInput
    dish_reviews?: dish_reviewsCreateNestedManyWithoutUsersInput
    restaurant_bids?: restaurant_bidsCreateNestedManyWithoutUsersInput
  }

  export type usersUncheckedCreateWithoutDish_mediaInput = {
    id?: string
    username: string
    display_name?: string | null
    avatar?: string | null
    bio?: string | null
    last_login_at?: Date | string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    dish_likes?: dish_likesUncheckedCreateNestedManyWithoutUsersInput
    dish_reviews?: dish_reviewsUncheckedCreateNestedManyWithoutUsersInput
    restaurant_bids?: restaurant_bidsUncheckedCreateNestedManyWithoutUsersInput
  }

  export type usersCreateOrConnectWithoutDish_mediaInput = {
    where: usersWhereUniqueInput
    create: XOR<usersCreateWithoutDish_mediaInput, usersUncheckedCreateWithoutDish_mediaInput>
  }

  export type payoutsCreateWithoutDish_mediaInput = {
    id?: string
    transfer_id: string
    amount_cents: bigint | number
    currency_code?: string | null
    status: $Enums.payout_status
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    restaurant_bids: restaurant_bidsCreateNestedOneWithoutPayoutsInput
  }

  export type payoutsUncheckedCreateWithoutDish_mediaInput = {
    id?: string
    bid_id: string
    transfer_id: string
    amount_cents: bigint | number
    currency_code?: string | null
    status: $Enums.payout_status
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
  }

  export type payoutsCreateOrConnectWithoutDish_mediaInput = {
    where: payoutsWhereUniqueInput
    create: XOR<payoutsCreateWithoutDish_mediaInput, payoutsUncheckedCreateWithoutDish_mediaInput>
  }

  export type payoutsCreateManyDish_mediaInputEnvelope = {
    data: payoutsCreateManyDish_mediaInput | payoutsCreateManyDish_mediaInput[]
    skipDuplicates?: boolean
  }

  export type dish_likesUpsertWithWhereUniqueWithoutDish_mediaInput = {
    where: dish_likesWhereUniqueInput
    update: XOR<dish_likesUpdateWithoutDish_mediaInput, dish_likesUncheckedUpdateWithoutDish_mediaInput>
    create: XOR<dish_likesCreateWithoutDish_mediaInput, dish_likesUncheckedCreateWithoutDish_mediaInput>
  }

  export type dish_likesUpdateWithWhereUniqueWithoutDish_mediaInput = {
    where: dish_likesWhereUniqueInput
    data: XOR<dish_likesUpdateWithoutDish_mediaInput, dish_likesUncheckedUpdateWithoutDish_mediaInput>
  }

  export type dish_likesUpdateManyWithWhereWithoutDish_mediaInput = {
    where: dish_likesScalarWhereInput
    data: XOR<dish_likesUpdateManyMutationInput, dish_likesUncheckedUpdateManyWithoutDish_mediaInput>
  }

  export type dish_likesScalarWhereInput = {
    AND?: dish_likesScalarWhereInput | dish_likesScalarWhereInput[]
    OR?: dish_likesScalarWhereInput[]
    NOT?: dish_likesScalarWhereInput | dish_likesScalarWhereInput[]
    id?: UuidFilter<"dish_likes"> | string
    dish_media_id?: UuidFilter<"dish_likes"> | string
    user_id?: UuidFilter<"dish_likes"> | string
    created_at?: DateTimeFilter<"dish_likes"> | Date | string
  }

  export type dishesUpsertWithoutDish_mediaInput = {
    update: XOR<dishesUpdateWithoutDish_mediaInput, dishesUncheckedUpdateWithoutDish_mediaInput>
    create: XOR<dishesCreateWithoutDish_mediaInput, dishesUncheckedCreateWithoutDish_mediaInput>
    where?: dishesWhereInput
  }

  export type dishesUpdateToOneWithWhereWithoutDish_mediaInput = {
    where?: dishesWhereInput
    data: XOR<dishesUpdateWithoutDish_mediaInput, dishesUncheckedUpdateWithoutDish_mediaInput>
  }

  export type dishesUpdateWithoutDish_mediaInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    dish_reviews?: dish_reviewsUpdateManyWithoutDishesNestedInput
    dish_categories?: dish_categoriesUpdateOneRequiredWithoutDishesNestedInput
    restaurants?: restaurantsUpdateOneWithoutDishesNestedInput
  }

  export type dishesUncheckedUpdateWithoutDish_mediaInput = {
    id?: StringFieldUpdateOperationsInput | string
    restaurant_id?: NullableStringFieldUpdateOperationsInput | string | null
    category_id?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    dish_reviews?: dish_reviewsUncheckedUpdateManyWithoutDishesNestedInput
  }

  export type usersUpsertWithoutDish_mediaInput = {
    update: XOR<usersUpdateWithoutDish_mediaInput, usersUncheckedUpdateWithoutDish_mediaInput>
    create: XOR<usersCreateWithoutDish_mediaInput, usersUncheckedCreateWithoutDish_mediaInput>
    where?: usersWhereInput
  }

  export type usersUpdateToOneWithWhereWithoutDish_mediaInput = {
    where?: usersWhereInput
    data: XOR<usersUpdateWithoutDish_mediaInput, usersUncheckedUpdateWithoutDish_mediaInput>
  }

  export type usersUpdateWithoutDish_mediaInput = {
    id?: StringFieldUpdateOperationsInput | string
    username?: StringFieldUpdateOperationsInput | string
    display_name?: NullableStringFieldUpdateOperationsInput | string | null
    avatar?: NullableStringFieldUpdateOperationsInput | string | null
    bio?: NullableStringFieldUpdateOperationsInput | string | null
    last_login_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    dish_likes?: dish_likesUpdateManyWithoutUsersNestedInput
    dish_reviews?: dish_reviewsUpdateManyWithoutUsersNestedInput
    restaurant_bids?: restaurant_bidsUpdateManyWithoutUsersNestedInput
  }

  export type usersUncheckedUpdateWithoutDish_mediaInput = {
    id?: StringFieldUpdateOperationsInput | string
    username?: StringFieldUpdateOperationsInput | string
    display_name?: NullableStringFieldUpdateOperationsInput | string | null
    avatar?: NullableStringFieldUpdateOperationsInput | string | null
    bio?: NullableStringFieldUpdateOperationsInput | string | null
    last_login_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    dish_likes?: dish_likesUncheckedUpdateManyWithoutUsersNestedInput
    dish_reviews?: dish_reviewsUncheckedUpdateManyWithoutUsersNestedInput
    restaurant_bids?: restaurant_bidsUncheckedUpdateManyWithoutUsersNestedInput
  }

  export type payoutsUpsertWithWhereUniqueWithoutDish_mediaInput = {
    where: payoutsWhereUniqueInput
    update: XOR<payoutsUpdateWithoutDish_mediaInput, payoutsUncheckedUpdateWithoutDish_mediaInput>
    create: XOR<payoutsCreateWithoutDish_mediaInput, payoutsUncheckedCreateWithoutDish_mediaInput>
  }

  export type payoutsUpdateWithWhereUniqueWithoutDish_mediaInput = {
    where: payoutsWhereUniqueInput
    data: XOR<payoutsUpdateWithoutDish_mediaInput, payoutsUncheckedUpdateWithoutDish_mediaInput>
  }

  export type payoutsUpdateManyWithWhereWithoutDish_mediaInput = {
    where: payoutsScalarWhereInput
    data: XOR<payoutsUpdateManyMutationInput, payoutsUncheckedUpdateManyWithoutDish_mediaInput>
  }

  export type payoutsScalarWhereInput = {
    AND?: payoutsScalarWhereInput | payoutsScalarWhereInput[]
    OR?: payoutsScalarWhereInput[]
    NOT?: payoutsScalarWhereInput | payoutsScalarWhereInput[]
    id?: UuidFilter<"payouts"> | string
    bid_id?: UuidFilter<"payouts"> | string
    transfer_id?: StringFilter<"payouts"> | string
    dish_media_id?: UuidFilter<"payouts"> | string
    amount_cents?: BigIntFilter<"payouts"> | bigint | number
    currency_code?: StringNullableFilter<"payouts"> | string | null
    status?: Enumpayout_statusFilter<"payouts"> | $Enums.payout_status
    created_at?: DateTimeFilter<"payouts"> | Date | string
    updated_at?: DateTimeFilter<"payouts"> | Date | string
    lock_no?: IntFilter<"payouts"> | number
  }

  export type dishesCreateWithoutDish_reviewsInput = {
    id?: string
    name?: string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    dish_media?: dish_mediaCreateNestedManyWithoutDishesInput
    dish_categories: dish_categoriesCreateNestedOneWithoutDishesInput
    restaurants?: restaurantsCreateNestedOneWithoutDishesInput
  }

  export type dishesUncheckedCreateWithoutDish_reviewsInput = {
    id?: string
    restaurant_id?: string | null
    category_id: string
    name?: string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    dish_media?: dish_mediaUncheckedCreateNestedManyWithoutDishesInput
  }

  export type dishesCreateOrConnectWithoutDish_reviewsInput = {
    where: dishesWhereUniqueInput
    create: XOR<dishesCreateWithoutDish_reviewsInput, dishesUncheckedCreateWithoutDish_reviewsInput>
  }

  export type usersCreateWithoutDish_reviewsInput = {
    id?: string
    username: string
    display_name?: string | null
    avatar?: string | null
    bio?: string | null
    last_login_at?: Date | string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    dish_likes?: dish_likesCreateNestedManyWithoutUsersInput
    dish_media?: dish_mediaCreateNestedManyWithoutUsersInput
    restaurant_bids?: restaurant_bidsCreateNestedManyWithoutUsersInput
  }

  export type usersUncheckedCreateWithoutDish_reviewsInput = {
    id?: string
    username: string
    display_name?: string | null
    avatar?: string | null
    bio?: string | null
    last_login_at?: Date | string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    dish_likes?: dish_likesUncheckedCreateNestedManyWithoutUsersInput
    dish_media?: dish_mediaUncheckedCreateNestedManyWithoutUsersInput
    restaurant_bids?: restaurant_bidsUncheckedCreateNestedManyWithoutUsersInput
  }

  export type usersCreateOrConnectWithoutDish_reviewsInput = {
    where: usersWhereUniqueInput
    create: XOR<usersCreateWithoutDish_reviewsInput, usersUncheckedCreateWithoutDish_reviewsInput>
  }

  export type dishesUpsertWithoutDish_reviewsInput = {
    update: XOR<dishesUpdateWithoutDish_reviewsInput, dishesUncheckedUpdateWithoutDish_reviewsInput>
    create: XOR<dishesCreateWithoutDish_reviewsInput, dishesUncheckedCreateWithoutDish_reviewsInput>
    where?: dishesWhereInput
  }

  export type dishesUpdateToOneWithWhereWithoutDish_reviewsInput = {
    where?: dishesWhereInput
    data: XOR<dishesUpdateWithoutDish_reviewsInput, dishesUncheckedUpdateWithoutDish_reviewsInput>
  }

  export type dishesUpdateWithoutDish_reviewsInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    dish_media?: dish_mediaUpdateManyWithoutDishesNestedInput
    dish_categories?: dish_categoriesUpdateOneRequiredWithoutDishesNestedInput
    restaurants?: restaurantsUpdateOneWithoutDishesNestedInput
  }

  export type dishesUncheckedUpdateWithoutDish_reviewsInput = {
    id?: StringFieldUpdateOperationsInput | string
    restaurant_id?: NullableStringFieldUpdateOperationsInput | string | null
    category_id?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    dish_media?: dish_mediaUncheckedUpdateManyWithoutDishesNestedInput
  }

  export type usersUpsertWithoutDish_reviewsInput = {
    update: XOR<usersUpdateWithoutDish_reviewsInput, usersUncheckedUpdateWithoutDish_reviewsInput>
    create: XOR<usersCreateWithoutDish_reviewsInput, usersUncheckedCreateWithoutDish_reviewsInput>
    where?: usersWhereInput
  }

  export type usersUpdateToOneWithWhereWithoutDish_reviewsInput = {
    where?: usersWhereInput
    data: XOR<usersUpdateWithoutDish_reviewsInput, usersUncheckedUpdateWithoutDish_reviewsInput>
  }

  export type usersUpdateWithoutDish_reviewsInput = {
    id?: StringFieldUpdateOperationsInput | string
    username?: StringFieldUpdateOperationsInput | string
    display_name?: NullableStringFieldUpdateOperationsInput | string | null
    avatar?: NullableStringFieldUpdateOperationsInput | string | null
    bio?: NullableStringFieldUpdateOperationsInput | string | null
    last_login_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    dish_likes?: dish_likesUpdateManyWithoutUsersNestedInput
    dish_media?: dish_mediaUpdateManyWithoutUsersNestedInput
    restaurant_bids?: restaurant_bidsUpdateManyWithoutUsersNestedInput
  }

  export type usersUncheckedUpdateWithoutDish_reviewsInput = {
    id?: StringFieldUpdateOperationsInput | string
    username?: StringFieldUpdateOperationsInput | string
    display_name?: NullableStringFieldUpdateOperationsInput | string | null
    avatar?: NullableStringFieldUpdateOperationsInput | string | null
    bio?: NullableStringFieldUpdateOperationsInput | string | null
    last_login_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    dish_likes?: dish_likesUncheckedUpdateManyWithoutUsersNestedInput
    dish_media?: dish_mediaUncheckedUpdateManyWithoutUsersNestedInput
    restaurant_bids?: restaurant_bidsUncheckedUpdateManyWithoutUsersNestedInput
  }

  export type dish_mediaCreateWithoutDishesInput = {
    id?: string
    media_path: string
    media_type: string
    thumbnail_path?: string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    dish_likes?: dish_likesCreateNestedManyWithoutDish_mediaInput
    users?: usersCreateNestedOneWithoutDish_mediaInput
    payouts?: payoutsCreateNestedManyWithoutDish_mediaInput
  }

  export type dish_mediaUncheckedCreateWithoutDishesInput = {
    id?: string
    user_id?: string | null
    media_path: string
    media_type: string
    thumbnail_path?: string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    dish_likes?: dish_likesUncheckedCreateNestedManyWithoutDish_mediaInput
    payouts?: payoutsUncheckedCreateNestedManyWithoutDish_mediaInput
  }

  export type dish_mediaCreateOrConnectWithoutDishesInput = {
    where: dish_mediaWhereUniqueInput
    create: XOR<dish_mediaCreateWithoutDishesInput, dish_mediaUncheckedCreateWithoutDishesInput>
  }

  export type dish_mediaCreateManyDishesInputEnvelope = {
    data: dish_mediaCreateManyDishesInput | dish_mediaCreateManyDishesInput[]
    skipDuplicates?: boolean
  }

  export type dish_reviewsCreateWithoutDishesInput = {
    id?: string
    comment: string
    rating: number
    price_cents?: number | null
    currency_code?: string | null
    created_dish_media_id?: string | null
    imported_user_name?: string | null
    imported_user_avatar?: string | null
    created_at?: Date | string
    users?: usersCreateNestedOneWithoutDish_reviewsInput
  }

  export type dish_reviewsUncheckedCreateWithoutDishesInput = {
    id?: string
    comment: string
    user_id?: string | null
    rating: number
    price_cents?: number | null
    currency_code?: string | null
    created_dish_media_id?: string | null
    imported_user_name?: string | null
    imported_user_avatar?: string | null
    created_at?: Date | string
  }

  export type dish_reviewsCreateOrConnectWithoutDishesInput = {
    where: dish_reviewsWhereUniqueInput
    create: XOR<dish_reviewsCreateWithoutDishesInput, dish_reviewsUncheckedCreateWithoutDishesInput>
  }

  export type dish_reviewsCreateManyDishesInputEnvelope = {
    data: dish_reviewsCreateManyDishesInput | dish_reviewsCreateManyDishesInput[]
    skipDuplicates?: boolean
  }

  export type dish_categoriesCreateWithoutDishesInput = {
    id: string
    label_en: string
    labels: JsonNullValueInput | InputJsonValue
    image_url: string
    origin?: dish_categoriesCreateoriginInput | string[]
    cuisine?: dish_categoriesCreatecuisineInput | string[]
    tags?: dish_categoriesCreatetagsInput | string[]
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    dish_category_variants?: dish_category_variantsCreateNestedManyWithoutDish_categoriesInput
  }

  export type dish_categoriesUncheckedCreateWithoutDishesInput = {
    id: string
    label_en: string
    labels: JsonNullValueInput | InputJsonValue
    image_url: string
    origin?: dish_categoriesCreateoriginInput | string[]
    cuisine?: dish_categoriesCreatecuisineInput | string[]
    tags?: dish_categoriesCreatetagsInput | string[]
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    dish_category_variants?: dish_category_variantsUncheckedCreateNestedManyWithoutDish_categoriesInput
  }

  export type dish_categoriesCreateOrConnectWithoutDishesInput = {
    where: dish_categoriesWhereUniqueInput
    create: XOR<dish_categoriesCreateWithoutDishesInput, dish_categoriesUncheckedCreateWithoutDishesInput>
  }

  export type dish_mediaUpsertWithWhereUniqueWithoutDishesInput = {
    where: dish_mediaWhereUniqueInput
    update: XOR<dish_mediaUpdateWithoutDishesInput, dish_mediaUncheckedUpdateWithoutDishesInput>
    create: XOR<dish_mediaCreateWithoutDishesInput, dish_mediaUncheckedCreateWithoutDishesInput>
  }

  export type dish_mediaUpdateWithWhereUniqueWithoutDishesInput = {
    where: dish_mediaWhereUniqueInput
    data: XOR<dish_mediaUpdateWithoutDishesInput, dish_mediaUncheckedUpdateWithoutDishesInput>
  }

  export type dish_mediaUpdateManyWithWhereWithoutDishesInput = {
    where: dish_mediaScalarWhereInput
    data: XOR<dish_mediaUpdateManyMutationInput, dish_mediaUncheckedUpdateManyWithoutDishesInput>
  }

  export type dish_mediaScalarWhereInput = {
    AND?: dish_mediaScalarWhereInput | dish_mediaScalarWhereInput[]
    OR?: dish_mediaScalarWhereInput[]
    NOT?: dish_mediaScalarWhereInput | dish_mediaScalarWhereInput[]
    id?: UuidFilter<"dish_media"> | string
    dish_id?: UuidFilter<"dish_media"> | string
    user_id?: UuidNullableFilter<"dish_media"> | string | null
    media_path?: StringFilter<"dish_media"> | string
    media_type?: StringFilter<"dish_media"> | string
    thumbnail_path?: StringNullableFilter<"dish_media"> | string | null
    created_at?: DateTimeFilter<"dish_media"> | Date | string
    updated_at?: DateTimeFilter<"dish_media"> | Date | string
    lock_no?: IntFilter<"dish_media"> | number
  }

  export type dish_reviewsUpsertWithWhereUniqueWithoutDishesInput = {
    where: dish_reviewsWhereUniqueInput
    update: XOR<dish_reviewsUpdateWithoutDishesInput, dish_reviewsUncheckedUpdateWithoutDishesInput>
    create: XOR<dish_reviewsCreateWithoutDishesInput, dish_reviewsUncheckedCreateWithoutDishesInput>
  }

  export type dish_reviewsUpdateWithWhereUniqueWithoutDishesInput = {
    where: dish_reviewsWhereUniqueInput
    data: XOR<dish_reviewsUpdateWithoutDishesInput, dish_reviewsUncheckedUpdateWithoutDishesInput>
  }

  export type dish_reviewsUpdateManyWithWhereWithoutDishesInput = {
    where: dish_reviewsScalarWhereInput
    data: XOR<dish_reviewsUpdateManyMutationInput, dish_reviewsUncheckedUpdateManyWithoutDishesInput>
  }

  export type dish_reviewsScalarWhereInput = {
    AND?: dish_reviewsScalarWhereInput | dish_reviewsScalarWhereInput[]
    OR?: dish_reviewsScalarWhereInput[]
    NOT?: dish_reviewsScalarWhereInput | dish_reviewsScalarWhereInput[]
    id?: UuidFilter<"dish_reviews"> | string
    dish_id?: UuidFilter<"dish_reviews"> | string
    comment?: StringFilter<"dish_reviews"> | string
    user_id?: UuidNullableFilter<"dish_reviews"> | string | null
    rating?: IntFilter<"dish_reviews"> | number
    price_cents?: IntNullableFilter<"dish_reviews"> | number | null
    currency_code?: StringNullableFilter<"dish_reviews"> | string | null
    created_dish_media_id?: UuidNullableFilter<"dish_reviews"> | string | null
    imported_user_name?: StringNullableFilter<"dish_reviews"> | string | null
    imported_user_avatar?: StringNullableFilter<"dish_reviews"> | string | null
    created_at?: DateTimeFilter<"dish_reviews"> | Date | string
  }

  export type dish_categoriesUpsertWithoutDishesInput = {
    update: XOR<dish_categoriesUpdateWithoutDishesInput, dish_categoriesUncheckedUpdateWithoutDishesInput>
    create: XOR<dish_categoriesCreateWithoutDishesInput, dish_categoriesUncheckedCreateWithoutDishesInput>
    where?: dish_categoriesWhereInput
  }

  export type dish_categoriesUpdateToOneWithWhereWithoutDishesInput = {
    where?: dish_categoriesWhereInput
    data: XOR<dish_categoriesUpdateWithoutDishesInput, dish_categoriesUncheckedUpdateWithoutDishesInput>
  }

  export type dish_categoriesUpdateWithoutDishesInput = {
    id?: StringFieldUpdateOperationsInput | string
    label_en?: StringFieldUpdateOperationsInput | string
    labels?: JsonNullValueInput | InputJsonValue
    image_url?: StringFieldUpdateOperationsInput | string
    origin?: dish_categoriesUpdateoriginInput | string[]
    cuisine?: dish_categoriesUpdatecuisineInput | string[]
    tags?: dish_categoriesUpdatetagsInput | string[]
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    dish_category_variants?: dish_category_variantsUpdateManyWithoutDish_categoriesNestedInput
  }

  export type dish_categoriesUncheckedUpdateWithoutDishesInput = {
    id?: StringFieldUpdateOperationsInput | string
    label_en?: StringFieldUpdateOperationsInput | string
    labels?: JsonNullValueInput | InputJsonValue
    image_url?: StringFieldUpdateOperationsInput | string
    origin?: dish_categoriesUpdateoriginInput | string[]
    cuisine?: dish_categoriesUpdatecuisineInput | string[]
    tags?: dish_categoriesUpdatetagsInput | string[]
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    dish_category_variants?: dish_category_variantsUncheckedUpdateManyWithoutDish_categoriesNestedInput
  }

  export type restaurantsUpdateToOneWithWhereWithoutDishesInput = {
    where?: restaurantsWhereInput
    data: XOR<restaurantsUpdateWithoutDishesInput, restaurantsUncheckedUpdateWithoutDishesInput>
  }

  export type restaurantsUpdateWithoutDishesInput = {
    id?: StringFieldUpdateOperationsInput | string
    google_place_id?: NullableStringFieldUpdateOperationsInput | string | null
    name?: StringFieldUpdateOperationsInput | string
    image_url?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    restaurant_bids?: restaurant_bidsUpdateManyWithoutRestaurantsNestedInput
  }

  export type restaurantsUncheckedUpdateWithoutDishesInput = {
    id?: StringFieldUpdateOperationsInput | string
    google_place_id?: NullableStringFieldUpdateOperationsInput | string | null
    name?: StringFieldUpdateOperationsInput | string
    image_url?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    restaurant_bids?: restaurant_bidsUncheckedUpdateManyWithoutRestaurantsNestedInput
  }

  export type restaurant_bidsCreateWithoutPayoutsInput = {
    id?: string
    payment_intent_id?: string | null
    amount_cents: bigint | number
    currency_code: string
    start_date: Date | string
    end_date: Date | string
    status: $Enums.restaurant_bid_status
    refund_id?: string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    restaurants: restaurantsCreateNestedOneWithoutRestaurant_bidsInput
    users: usersCreateNestedOneWithoutRestaurant_bidsInput
  }

  export type restaurant_bidsUncheckedCreateWithoutPayoutsInput = {
    id?: string
    restaurant_id: string
    user_id: string
    payment_intent_id?: string | null
    amount_cents: bigint | number
    currency_code: string
    start_date: Date | string
    end_date: Date | string
    status: $Enums.restaurant_bid_status
    refund_id?: string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
  }

  export type restaurant_bidsCreateOrConnectWithoutPayoutsInput = {
    where: restaurant_bidsWhereUniqueInput
    create: XOR<restaurant_bidsCreateWithoutPayoutsInput, restaurant_bidsUncheckedCreateWithoutPayoutsInput>
  }

  export type dish_mediaCreateWithoutPayoutsInput = {
    id?: string
    media_path: string
    media_type: string
    thumbnail_path?: string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    dish_likes?: dish_likesCreateNestedManyWithoutDish_mediaInput
    dishes: dishesCreateNestedOneWithoutDish_mediaInput
    users?: usersCreateNestedOneWithoutDish_mediaInput
  }

  export type dish_mediaUncheckedCreateWithoutPayoutsInput = {
    id?: string
    dish_id: string
    user_id?: string | null
    media_path: string
    media_type: string
    thumbnail_path?: string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    dish_likes?: dish_likesUncheckedCreateNestedManyWithoutDish_mediaInput
  }

  export type dish_mediaCreateOrConnectWithoutPayoutsInput = {
    where: dish_mediaWhereUniqueInput
    create: XOR<dish_mediaCreateWithoutPayoutsInput, dish_mediaUncheckedCreateWithoutPayoutsInput>
  }

  export type restaurant_bidsUpsertWithoutPayoutsInput = {
    update: XOR<restaurant_bidsUpdateWithoutPayoutsInput, restaurant_bidsUncheckedUpdateWithoutPayoutsInput>
    create: XOR<restaurant_bidsCreateWithoutPayoutsInput, restaurant_bidsUncheckedCreateWithoutPayoutsInput>
    where?: restaurant_bidsWhereInput
  }

  export type restaurant_bidsUpdateToOneWithWhereWithoutPayoutsInput = {
    where?: restaurant_bidsWhereInput
    data: XOR<restaurant_bidsUpdateWithoutPayoutsInput, restaurant_bidsUncheckedUpdateWithoutPayoutsInput>
  }

  export type restaurant_bidsUpdateWithoutPayoutsInput = {
    id?: StringFieldUpdateOperationsInput | string
    payment_intent_id?: NullableStringFieldUpdateOperationsInput | string | null
    amount_cents?: BigIntFieldUpdateOperationsInput | bigint | number
    currency_code?: StringFieldUpdateOperationsInput | string
    start_date?: DateTimeFieldUpdateOperationsInput | Date | string
    end_date?: DateTimeFieldUpdateOperationsInput | Date | string
    status?: Enumrestaurant_bid_statusFieldUpdateOperationsInput | $Enums.restaurant_bid_status
    refund_id?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    restaurants?: restaurantsUpdateOneRequiredWithoutRestaurant_bidsNestedInput
    users?: usersUpdateOneRequiredWithoutRestaurant_bidsNestedInput
  }

  export type restaurant_bidsUncheckedUpdateWithoutPayoutsInput = {
    id?: StringFieldUpdateOperationsInput | string
    restaurant_id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    payment_intent_id?: NullableStringFieldUpdateOperationsInput | string | null
    amount_cents?: BigIntFieldUpdateOperationsInput | bigint | number
    currency_code?: StringFieldUpdateOperationsInput | string
    start_date?: DateTimeFieldUpdateOperationsInput | Date | string
    end_date?: DateTimeFieldUpdateOperationsInput | Date | string
    status?: Enumrestaurant_bid_statusFieldUpdateOperationsInput | $Enums.restaurant_bid_status
    refund_id?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
  }

  export type dish_mediaUpsertWithoutPayoutsInput = {
    update: XOR<dish_mediaUpdateWithoutPayoutsInput, dish_mediaUncheckedUpdateWithoutPayoutsInput>
    create: XOR<dish_mediaCreateWithoutPayoutsInput, dish_mediaUncheckedCreateWithoutPayoutsInput>
    where?: dish_mediaWhereInput
  }

  export type dish_mediaUpdateToOneWithWhereWithoutPayoutsInput = {
    where?: dish_mediaWhereInput
    data: XOR<dish_mediaUpdateWithoutPayoutsInput, dish_mediaUncheckedUpdateWithoutPayoutsInput>
  }

  export type dish_mediaUpdateWithoutPayoutsInput = {
    id?: StringFieldUpdateOperationsInput | string
    media_path?: StringFieldUpdateOperationsInput | string
    media_type?: StringFieldUpdateOperationsInput | string
    thumbnail_path?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    dish_likes?: dish_likesUpdateManyWithoutDish_mediaNestedInput
    dishes?: dishesUpdateOneRequiredWithoutDish_mediaNestedInput
    users?: usersUpdateOneWithoutDish_mediaNestedInput
  }

  export type dish_mediaUncheckedUpdateWithoutPayoutsInput = {
    id?: StringFieldUpdateOperationsInput | string
    dish_id?: StringFieldUpdateOperationsInput | string
    user_id?: NullableStringFieldUpdateOperationsInput | string | null
    media_path?: StringFieldUpdateOperationsInput | string
    media_type?: StringFieldUpdateOperationsInput | string
    thumbnail_path?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    dish_likes?: dish_likesUncheckedUpdateManyWithoutDish_mediaNestedInput
  }

  export type payoutsCreateWithoutRestaurant_bidsInput = {
    id?: string
    transfer_id: string
    amount_cents: bigint | number
    currency_code?: string | null
    status: $Enums.payout_status
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    dish_media: dish_mediaCreateNestedOneWithoutPayoutsInput
  }

  export type payoutsUncheckedCreateWithoutRestaurant_bidsInput = {
    id?: string
    transfer_id: string
    dish_media_id: string
    amount_cents: bigint | number
    currency_code?: string | null
    status: $Enums.payout_status
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
  }

  export type payoutsCreateOrConnectWithoutRestaurant_bidsInput = {
    where: payoutsWhereUniqueInput
    create: XOR<payoutsCreateWithoutRestaurant_bidsInput, payoutsUncheckedCreateWithoutRestaurant_bidsInput>
  }

  export type payoutsCreateManyRestaurant_bidsInputEnvelope = {
    data: payoutsCreateManyRestaurant_bidsInput | payoutsCreateManyRestaurant_bidsInput[]
    skipDuplicates?: boolean
  }

  export type usersCreateWithoutRestaurant_bidsInput = {
    id?: string
    username: string
    display_name?: string | null
    avatar?: string | null
    bio?: string | null
    last_login_at?: Date | string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    dish_likes?: dish_likesCreateNestedManyWithoutUsersInput
    dish_media?: dish_mediaCreateNestedManyWithoutUsersInput
    dish_reviews?: dish_reviewsCreateNestedManyWithoutUsersInput
  }

  export type usersUncheckedCreateWithoutRestaurant_bidsInput = {
    id?: string
    username: string
    display_name?: string | null
    avatar?: string | null
    bio?: string | null
    last_login_at?: Date | string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    dish_likes?: dish_likesUncheckedCreateNestedManyWithoutUsersInput
    dish_media?: dish_mediaUncheckedCreateNestedManyWithoutUsersInput
    dish_reviews?: dish_reviewsUncheckedCreateNestedManyWithoutUsersInput
  }

  export type usersCreateOrConnectWithoutRestaurant_bidsInput = {
    where: usersWhereUniqueInput
    create: XOR<usersCreateWithoutRestaurant_bidsInput, usersUncheckedCreateWithoutRestaurant_bidsInput>
  }

  export type payoutsUpsertWithWhereUniqueWithoutRestaurant_bidsInput = {
    where: payoutsWhereUniqueInput
    update: XOR<payoutsUpdateWithoutRestaurant_bidsInput, payoutsUncheckedUpdateWithoutRestaurant_bidsInput>
    create: XOR<payoutsCreateWithoutRestaurant_bidsInput, payoutsUncheckedCreateWithoutRestaurant_bidsInput>
  }

  export type payoutsUpdateWithWhereUniqueWithoutRestaurant_bidsInput = {
    where: payoutsWhereUniqueInput
    data: XOR<payoutsUpdateWithoutRestaurant_bidsInput, payoutsUncheckedUpdateWithoutRestaurant_bidsInput>
  }

  export type payoutsUpdateManyWithWhereWithoutRestaurant_bidsInput = {
    where: payoutsScalarWhereInput
    data: XOR<payoutsUpdateManyMutationInput, payoutsUncheckedUpdateManyWithoutRestaurant_bidsInput>
  }

  export type restaurantsUpdateToOneWithWhereWithoutRestaurant_bidsInput = {
    where?: restaurantsWhereInput
    data: XOR<restaurantsUpdateWithoutRestaurant_bidsInput, restaurantsUncheckedUpdateWithoutRestaurant_bidsInput>
  }

  export type restaurantsUpdateWithoutRestaurant_bidsInput = {
    id?: StringFieldUpdateOperationsInput | string
    google_place_id?: NullableStringFieldUpdateOperationsInput | string | null
    name?: StringFieldUpdateOperationsInput | string
    image_url?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    dishes?: dishesUpdateManyWithoutRestaurantsNestedInput
  }

  export type restaurantsUncheckedUpdateWithoutRestaurant_bidsInput = {
    id?: StringFieldUpdateOperationsInput | string
    google_place_id?: NullableStringFieldUpdateOperationsInput | string | null
    name?: StringFieldUpdateOperationsInput | string
    image_url?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    dishes?: dishesUncheckedUpdateManyWithoutRestaurantsNestedInput
  }

  export type usersUpsertWithoutRestaurant_bidsInput = {
    update: XOR<usersUpdateWithoutRestaurant_bidsInput, usersUncheckedUpdateWithoutRestaurant_bidsInput>
    create: XOR<usersCreateWithoutRestaurant_bidsInput, usersUncheckedCreateWithoutRestaurant_bidsInput>
    where?: usersWhereInput
  }

  export type usersUpdateToOneWithWhereWithoutRestaurant_bidsInput = {
    where?: usersWhereInput
    data: XOR<usersUpdateWithoutRestaurant_bidsInput, usersUncheckedUpdateWithoutRestaurant_bidsInput>
  }

  export type usersUpdateWithoutRestaurant_bidsInput = {
    id?: StringFieldUpdateOperationsInput | string
    username?: StringFieldUpdateOperationsInput | string
    display_name?: NullableStringFieldUpdateOperationsInput | string | null
    avatar?: NullableStringFieldUpdateOperationsInput | string | null
    bio?: NullableStringFieldUpdateOperationsInput | string | null
    last_login_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    dish_likes?: dish_likesUpdateManyWithoutUsersNestedInput
    dish_media?: dish_mediaUpdateManyWithoutUsersNestedInput
    dish_reviews?: dish_reviewsUpdateManyWithoutUsersNestedInput
  }

  export type usersUncheckedUpdateWithoutRestaurant_bidsInput = {
    id?: StringFieldUpdateOperationsInput | string
    username?: StringFieldUpdateOperationsInput | string
    display_name?: NullableStringFieldUpdateOperationsInput | string | null
    avatar?: NullableStringFieldUpdateOperationsInput | string | null
    bio?: NullableStringFieldUpdateOperationsInput | string | null
    last_login_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    dish_likes?: dish_likesUncheckedUpdateManyWithoutUsersNestedInput
    dish_media?: dish_mediaUncheckedUpdateManyWithoutUsersNestedInput
    dish_reviews?: dish_reviewsUncheckedUpdateManyWithoutUsersNestedInput
  }

  export type dishesCreateWithoutRestaurantsInput = {
    id?: string
    name?: string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    dish_media?: dish_mediaCreateNestedManyWithoutDishesInput
    dish_reviews?: dish_reviewsCreateNestedManyWithoutDishesInput
    dish_categories: dish_categoriesCreateNestedOneWithoutDishesInput
  }

  export type dishesUncheckedCreateWithoutRestaurantsInput = {
    id?: string
    category_id: string
    name?: string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    dish_media?: dish_mediaUncheckedCreateNestedManyWithoutDishesInput
    dish_reviews?: dish_reviewsUncheckedCreateNestedManyWithoutDishesInput
  }

  export type dishesCreateOrConnectWithoutRestaurantsInput = {
    where: dishesWhereUniqueInput
    create: XOR<dishesCreateWithoutRestaurantsInput, dishesUncheckedCreateWithoutRestaurantsInput>
  }

  export type dishesUpsertWithWhereUniqueWithoutRestaurantsInput = {
    where: dishesWhereUniqueInput
    update: XOR<dishesUpdateWithoutRestaurantsInput, dishesUncheckedUpdateWithoutRestaurantsInput>
    create: XOR<dishesCreateWithoutRestaurantsInput, dishesUncheckedCreateWithoutRestaurantsInput>
  }

  export type dishesCreateManyRestaurantsInputEnvelope = {
    data: dishesCreateManyRestaurantsInput | dishesCreateManyRestaurantsInput[]
    skipDuplicates?: boolean
  }

  export type dishesUpdateWithWhereUniqueWithoutRestaurantsInput = {
    where: dishesWhereUniqueInput
    data: XOR<dishesUpdateWithoutRestaurantsInput, dishesUncheckedUpdateWithoutRestaurantsInput>
  }

  export type dishesUpdateManyWithWhereWithoutRestaurantsInput = {
    where: dishesScalarWhereInput
    data: XOR<dishesUpdateManyMutationInput, dishesUncheckedUpdateManyWithoutRestaurantsInput>
  }

  export type restaurant_bidsCreateWithoutRestaurantsInput = {
    id?: string
    payment_intent_id?: string | null
    amount_cents: bigint | number
    currency_code: string
    start_date: Date | string
    end_date: Date | string
    status: $Enums.restaurant_bid_status
    refund_id?: string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    payouts?: payoutsCreateNestedManyWithoutRestaurant_bidsInput
    users: usersCreateNestedOneWithoutRestaurant_bidsInput
  }

  export type restaurant_bidsUncheckedCreateWithoutRestaurantsInput = {
    id?: string
    user_id: string
    payment_intent_id?: string | null
    amount_cents: bigint | number
    currency_code: string
    start_date: Date | string
    end_date: Date | string
    status: $Enums.restaurant_bid_status
    refund_id?: string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    payouts?: payoutsUncheckedCreateNestedManyWithoutRestaurant_bidsInput
  }

  export type restaurant_bidsCreateOrConnectWithoutRestaurantsInput = {
    where: restaurant_bidsWhereUniqueInput
    create: XOR<restaurant_bidsCreateWithoutRestaurantsInput, restaurant_bidsUncheckedCreateWithoutRestaurantsInput>
  }

  export type restaurant_bidsUpsertWithWhereUniqueWithoutRestaurantsInput = {
    where: restaurant_bidsWhereUniqueInput
    update: XOR<restaurant_bidsUpdateWithoutRestaurantsInput, restaurant_bidsUncheckedUpdateWithoutRestaurantsInput>
    create: XOR<restaurant_bidsCreateWithoutRestaurantsInput, restaurant_bidsUncheckedCreateWithoutRestaurantsInput>
  }

  export type restaurant_bidsCreateManyRestaurantsInputEnvelope = {
    data: restaurant_bidsCreateManyRestaurantsInput | restaurant_bidsCreateManyRestaurantsInput[]
    skipDuplicates?: boolean
  }

  export type restaurant_bidsUpdateWithWhereUniqueWithoutRestaurantsInput = {
    where: restaurant_bidsWhereUniqueInput
    data: XOR<restaurant_bidsUpdateWithoutRestaurantsInput, restaurant_bidsUncheckedUpdateWithoutRestaurantsInput>
  }

  export type restaurant_bidsUpdateManyWithWhereWithoutRestaurantsInput = {
    where: restaurant_bidsScalarWhereInput
    data: XOR<restaurant_bidsUpdateManyMutationInput, restaurant_bidsUncheckedUpdateManyWithoutRestaurantsInput>
  }

  export type restaurant_bidsScalarWhereInput = {
    AND?: restaurant_bidsScalarWhereInput | restaurant_bidsScalarWhereInput[]
    OR?: restaurant_bidsScalarWhereInput[]
    NOT?: restaurant_bidsScalarWhereInput | restaurant_bidsScalarWhereInput[]
    id?: UuidFilter<"restaurant_bids"> | string
    restaurant_id?: UuidFilter<"restaurant_bids"> | string
    user_id?: UuidFilter<"restaurant_bids"> | string
    payment_intent_id?: StringNullableFilter<"restaurant_bids"> | string | null
    amount_cents?: BigIntFilter<"restaurant_bids"> | bigint | number
    currency_code?: StringFilter<"restaurant_bids"> | string
    start_date?: DateTimeFilter<"restaurant_bids"> | Date | string
    end_date?: DateTimeFilter<"restaurant_bids"> | Date | string
    status?: Enumrestaurant_bid_statusFilter<"restaurant_bids"> | $Enums.restaurant_bid_status
    refund_id?: StringNullableFilter<"restaurant_bids"> | string | null
    created_at?: DateTimeFilter<"restaurant_bids"> | Date | string
    updated_at?: DateTimeFilter<"restaurant_bids"> | Date | string
    lock_no?: IntFilter<"restaurant_bids"> | number
  }

  export type dish_likesCreateWithoutUsersInput = {
    id?: string
    created_at?: Date | string
    dish_media: dish_mediaCreateNestedOneWithoutDish_likesInput
  }

  export type dish_likesUncheckedCreateWithoutUsersInput = {
    id?: string
    dish_media_id: string
    created_at?: Date | string
  }

  export type dish_likesCreateOrConnectWithoutUsersInput = {
    where: dish_likesWhereUniqueInput
    create: XOR<dish_likesCreateWithoutUsersInput, dish_likesUncheckedCreateWithoutUsersInput>
  }

  export type dish_likesCreateManyUsersInputEnvelope = {
    data: dish_likesCreateManyUsersInput | dish_likesCreateManyUsersInput[]
    skipDuplicates?: boolean
  }

  export type dish_mediaCreateWithoutUsersInput = {
    id?: string
    media_path: string
    media_type: string
    thumbnail_path?: string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    dish_likes?: dish_likesCreateNestedManyWithoutDish_mediaInput
    dishes: dishesCreateNestedOneWithoutDish_mediaInput
    payouts?: payoutsCreateNestedManyWithoutDish_mediaInput
  }

  export type dish_mediaUncheckedCreateWithoutUsersInput = {
    id?: string
    dish_id: string
    media_path: string
    media_type: string
    thumbnail_path?: string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    dish_likes?: dish_likesUncheckedCreateNestedManyWithoutDish_mediaInput
    payouts?: payoutsUncheckedCreateNestedManyWithoutDish_mediaInput
  }

  export type dish_mediaCreateOrConnectWithoutUsersInput = {
    where: dish_mediaWhereUniqueInput
    create: XOR<dish_mediaCreateWithoutUsersInput, dish_mediaUncheckedCreateWithoutUsersInput>
  }

  export type dish_mediaCreateManyUsersInputEnvelope = {
    data: dish_mediaCreateManyUsersInput | dish_mediaCreateManyUsersInput[]
    skipDuplicates?: boolean
  }

  export type dish_reviewsCreateWithoutUsersInput = {
    id?: string
    comment: string
    rating: number
    price_cents?: number | null
    currency_code?: string | null
    created_dish_media_id?: string | null
    imported_user_name?: string | null
    imported_user_avatar?: string | null
    created_at?: Date | string
    dishes: dishesCreateNestedOneWithoutDish_reviewsInput
  }

  export type dish_reviewsUncheckedCreateWithoutUsersInput = {
    id?: string
    dish_id: string
    comment: string
    rating: number
    price_cents?: number | null
    currency_code?: string | null
    created_dish_media_id?: string | null
    imported_user_name?: string | null
    imported_user_avatar?: string | null
    created_at?: Date | string
  }

  export type dish_reviewsCreateOrConnectWithoutUsersInput = {
    where: dish_reviewsWhereUniqueInput
    create: XOR<dish_reviewsCreateWithoutUsersInput, dish_reviewsUncheckedCreateWithoutUsersInput>
  }

  export type dish_reviewsCreateManyUsersInputEnvelope = {
    data: dish_reviewsCreateManyUsersInput | dish_reviewsCreateManyUsersInput[]
    skipDuplicates?: boolean
  }

  export type restaurant_bidsCreateWithoutUsersInput = {
    id?: string
    payment_intent_id?: string | null
    amount_cents: bigint | number
    currency_code: string
    start_date: Date | string
    end_date: Date | string
    status: $Enums.restaurant_bid_status
    refund_id?: string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    payouts?: payoutsCreateNestedManyWithoutRestaurant_bidsInput
    restaurants: restaurantsCreateNestedOneWithoutRestaurant_bidsInput
  }

  export type restaurant_bidsUncheckedCreateWithoutUsersInput = {
    id?: string
    restaurant_id: string
    payment_intent_id?: string | null
    amount_cents: bigint | number
    currency_code: string
    start_date: Date | string
    end_date: Date | string
    status: $Enums.restaurant_bid_status
    refund_id?: string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
    payouts?: payoutsUncheckedCreateNestedManyWithoutRestaurant_bidsInput
  }

  export type restaurant_bidsCreateOrConnectWithoutUsersInput = {
    where: restaurant_bidsWhereUniqueInput
    create: XOR<restaurant_bidsCreateWithoutUsersInput, restaurant_bidsUncheckedCreateWithoutUsersInput>
  }

  export type restaurant_bidsCreateManyUsersInputEnvelope = {
    data: restaurant_bidsCreateManyUsersInput | restaurant_bidsCreateManyUsersInput[]
    skipDuplicates?: boolean
  }

  export type dish_likesUpsertWithWhereUniqueWithoutUsersInput = {
    where: dish_likesWhereUniqueInput
    update: XOR<dish_likesUpdateWithoutUsersInput, dish_likesUncheckedUpdateWithoutUsersInput>
    create: XOR<dish_likesCreateWithoutUsersInput, dish_likesUncheckedCreateWithoutUsersInput>
  }

  export type dish_likesUpdateWithWhereUniqueWithoutUsersInput = {
    where: dish_likesWhereUniqueInput
    data: XOR<dish_likesUpdateWithoutUsersInput, dish_likesUncheckedUpdateWithoutUsersInput>
  }

  export type dish_likesUpdateManyWithWhereWithoutUsersInput = {
    where: dish_likesScalarWhereInput
    data: XOR<dish_likesUpdateManyMutationInput, dish_likesUncheckedUpdateManyWithoutUsersInput>
  }

  export type dish_mediaUpsertWithWhereUniqueWithoutUsersInput = {
    where: dish_mediaWhereUniqueInput
    update: XOR<dish_mediaUpdateWithoutUsersInput, dish_mediaUncheckedUpdateWithoutUsersInput>
    create: XOR<dish_mediaCreateWithoutUsersInput, dish_mediaUncheckedCreateWithoutUsersInput>
  }

  export type dish_mediaUpdateWithWhereUniqueWithoutUsersInput = {
    where: dish_mediaWhereUniqueInput
    data: XOR<dish_mediaUpdateWithoutUsersInput, dish_mediaUncheckedUpdateWithoutUsersInput>
  }

  export type dish_mediaUpdateManyWithWhereWithoutUsersInput = {
    where: dish_mediaScalarWhereInput
    data: XOR<dish_mediaUpdateManyMutationInput, dish_mediaUncheckedUpdateManyWithoutUsersInput>
  }

  export type dish_reviewsUpsertWithWhereUniqueWithoutUsersInput = {
    where: dish_reviewsWhereUniqueInput
    update: XOR<dish_reviewsUpdateWithoutUsersInput, dish_reviewsUncheckedUpdateWithoutUsersInput>
    create: XOR<dish_reviewsCreateWithoutUsersInput, dish_reviewsUncheckedCreateWithoutUsersInput>
  }

  export type dish_reviewsUpdateWithWhereUniqueWithoutUsersInput = {
    where: dish_reviewsWhereUniqueInput
    data: XOR<dish_reviewsUpdateWithoutUsersInput, dish_reviewsUncheckedUpdateWithoutUsersInput>
  }

  export type dish_reviewsUpdateManyWithWhereWithoutUsersInput = {
    where: dish_reviewsScalarWhereInput
    data: XOR<dish_reviewsUpdateManyMutationInput, dish_reviewsUncheckedUpdateManyWithoutUsersInput>
  }

  export type restaurant_bidsUpsertWithWhereUniqueWithoutUsersInput = {
    where: restaurant_bidsWhereUniqueInput
    update: XOR<restaurant_bidsUpdateWithoutUsersInput, restaurant_bidsUncheckedUpdateWithoutUsersInput>
    create: XOR<restaurant_bidsCreateWithoutUsersInput, restaurant_bidsUncheckedCreateWithoutUsersInput>
  }

  export type restaurant_bidsUpdateWithWhereUniqueWithoutUsersInput = {
    where: restaurant_bidsWhereUniqueInput
    data: XOR<restaurant_bidsUpdateWithoutUsersInput, restaurant_bidsUncheckedUpdateWithoutUsersInput>
  }

  export type restaurant_bidsUpdateManyWithWhereWithoutUsersInput = {
    where: restaurant_bidsScalarWhereInput
    data: XOR<restaurant_bidsUpdateManyMutationInput, restaurant_bidsUncheckedUpdateManyWithoutUsersInput>
  }

  export type dish_category_variantsCreateManyDish_categoriesInput = {
    id?: string
    surface_form: string
    source?: string | null
    created_at?: Date | string
  }

  export type dishesCreateManyDish_categoriesInput = {
    id?: string
    restaurant_id?: string | null
    name?: string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
  }

  export type dish_category_variantsUpdateWithoutDish_categoriesInput = {
    id?: StringFieldUpdateOperationsInput | string
    surface_form?: StringFieldUpdateOperationsInput | string
    source?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type dish_category_variantsUncheckedUpdateWithoutDish_categoriesInput = {
    id?: StringFieldUpdateOperationsInput | string
    surface_form?: StringFieldUpdateOperationsInput | string
    source?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type dish_category_variantsUncheckedUpdateManyWithoutDish_categoriesInput = {
    id?: StringFieldUpdateOperationsInput | string
    surface_form?: StringFieldUpdateOperationsInput | string
    source?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type dishesUpdateWithoutDish_categoriesInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    dish_media?: dish_mediaUpdateManyWithoutDishesNestedInput
    dish_reviews?: dish_reviewsUpdateManyWithoutDishesNestedInput
    restaurants?: restaurantsUpdateOneWithoutDishesNestedInput
  }

  export type dishesUncheckedUpdateWithoutDish_categoriesInput = {
    id?: StringFieldUpdateOperationsInput | string
    restaurant_id?: NullableStringFieldUpdateOperationsInput | string | null
    name?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    dish_media?: dish_mediaUncheckedUpdateManyWithoutDishesNestedInput
    dish_reviews?: dish_reviewsUncheckedUpdateManyWithoutDishesNestedInput
  }

  export type dishesUncheckedUpdateManyWithoutDish_categoriesInput = {
    id?: StringFieldUpdateOperationsInput | string
    restaurant_id?: NullableStringFieldUpdateOperationsInput | string | null
    name?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
  }

  export type dish_likesCreateManyDish_mediaInput = {
    id?: string
    user_id: string
    created_at?: Date | string
  }

  export type payoutsCreateManyDish_mediaInput = {
    id?: string
    bid_id: string
    transfer_id: string
    amount_cents: bigint | number
    currency_code?: string | null
    status: $Enums.payout_status
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
  }

  export type dish_likesUpdateWithoutDish_mediaInput = {
    id?: StringFieldUpdateOperationsInput | string
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    users?: usersUpdateOneRequiredWithoutDish_likesNestedInput
  }

  export type dish_likesUncheckedUpdateWithoutDish_mediaInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type dish_likesUncheckedUpdateManyWithoutDish_mediaInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type payoutsUpdateWithoutDish_mediaInput = {
    id?: StringFieldUpdateOperationsInput | string
    transfer_id?: StringFieldUpdateOperationsInput | string
    amount_cents?: BigIntFieldUpdateOperationsInput | bigint | number
    currency_code?: NullableStringFieldUpdateOperationsInput | string | null
    status?: Enumpayout_statusFieldUpdateOperationsInput | $Enums.payout_status
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    restaurant_bids?: restaurant_bidsUpdateOneRequiredWithoutPayoutsNestedInput
  }

  export type payoutsUncheckedUpdateWithoutDish_mediaInput = {
    id?: StringFieldUpdateOperationsInput | string
    bid_id?: StringFieldUpdateOperationsInput | string
    transfer_id?: StringFieldUpdateOperationsInput | string
    amount_cents?: BigIntFieldUpdateOperationsInput | bigint | number
    currency_code?: NullableStringFieldUpdateOperationsInput | string | null
    status?: Enumpayout_statusFieldUpdateOperationsInput | $Enums.payout_status
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
  }

  export type payoutsUncheckedUpdateManyWithoutDish_mediaInput = {
    id?: StringFieldUpdateOperationsInput | string
    bid_id?: StringFieldUpdateOperationsInput | string
    transfer_id?: StringFieldUpdateOperationsInput | string
    amount_cents?: BigIntFieldUpdateOperationsInput | bigint | number
    currency_code?: NullableStringFieldUpdateOperationsInput | string | null
    status?: Enumpayout_statusFieldUpdateOperationsInput | $Enums.payout_status
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
  }

  export type dish_mediaCreateManyDishesInput = {
    id?: string
    user_id?: string | null
    media_path: string
    media_type: string
    thumbnail_path?: string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
  }

  export type dish_reviewsCreateManyDishesInput = {
    id?: string
    comment: string
    user_id?: string | null
    rating: number
    price_cents?: number | null
    currency_code?: string | null
    created_dish_media_id?: string | null
    imported_user_name?: string | null
    imported_user_avatar?: string | null
    created_at?: Date | string
  }

  export type dish_mediaUpdateWithoutDishesInput = {
    id?: StringFieldUpdateOperationsInput | string
    media_path?: StringFieldUpdateOperationsInput | string
    media_type?: StringFieldUpdateOperationsInput | string
    thumbnail_path?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    dish_likes?: dish_likesUpdateManyWithoutDish_mediaNestedInput
    users?: usersUpdateOneWithoutDish_mediaNestedInput
    payouts?: payoutsUpdateManyWithoutDish_mediaNestedInput
  }

  export type dish_mediaUncheckedUpdateWithoutDishesInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: NullableStringFieldUpdateOperationsInput | string | null
    media_path?: StringFieldUpdateOperationsInput | string
    media_type?: StringFieldUpdateOperationsInput | string
    thumbnail_path?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    dish_likes?: dish_likesUncheckedUpdateManyWithoutDish_mediaNestedInput
    payouts?: payoutsUncheckedUpdateManyWithoutDish_mediaNestedInput
  }

  export type dish_mediaUncheckedUpdateManyWithoutDishesInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: NullableStringFieldUpdateOperationsInput | string | null
    media_path?: StringFieldUpdateOperationsInput | string
    media_type?: StringFieldUpdateOperationsInput | string
    thumbnail_path?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
  }

  export type dish_reviewsUpdateWithoutDishesInput = {
    id?: StringFieldUpdateOperationsInput | string
    comment?: StringFieldUpdateOperationsInput | string
    rating?: IntFieldUpdateOperationsInput | number
    price_cents?: NullableIntFieldUpdateOperationsInput | number | null
    currency_code?: NullableStringFieldUpdateOperationsInput | string | null
    created_dish_media_id?: NullableStringFieldUpdateOperationsInput | string | null
    imported_user_name?: NullableStringFieldUpdateOperationsInput | string | null
    imported_user_avatar?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    users?: usersUpdateOneWithoutDish_reviewsNestedInput
  }

  export type dish_reviewsUncheckedUpdateWithoutDishesInput = {
    id?: StringFieldUpdateOperationsInput | string
    comment?: StringFieldUpdateOperationsInput | string
    user_id?: NullableStringFieldUpdateOperationsInput | string | null
    rating?: IntFieldUpdateOperationsInput | number
    price_cents?: NullableIntFieldUpdateOperationsInput | number | null
    currency_code?: NullableStringFieldUpdateOperationsInput | string | null
    created_dish_media_id?: NullableStringFieldUpdateOperationsInput | string | null
    imported_user_name?: NullableStringFieldUpdateOperationsInput | string | null
    imported_user_avatar?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type dish_reviewsUncheckedUpdateManyWithoutDishesInput = {
    id?: StringFieldUpdateOperationsInput | string
    comment?: StringFieldUpdateOperationsInput | string
    user_id?: NullableStringFieldUpdateOperationsInput | string | null
    rating?: IntFieldUpdateOperationsInput | number
    price_cents?: NullableIntFieldUpdateOperationsInput | number | null
    currency_code?: NullableStringFieldUpdateOperationsInput | string | null
    created_dish_media_id?: NullableStringFieldUpdateOperationsInput | string | null
    imported_user_name?: NullableStringFieldUpdateOperationsInput | string | null
    imported_user_avatar?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type payoutsCreateManyRestaurant_bidsInput = {
    id?: string
    transfer_id: string
    dish_media_id: string
    amount_cents: bigint | number
    currency_code?: string | null
    status: $Enums.payout_status
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
  }

  export type payoutsUpdateWithoutRestaurant_bidsInput = {
    id?: StringFieldUpdateOperationsInput | string
    transfer_id?: StringFieldUpdateOperationsInput | string
    amount_cents?: BigIntFieldUpdateOperationsInput | bigint | number
    currency_code?: NullableStringFieldUpdateOperationsInput | string | null
    status?: Enumpayout_statusFieldUpdateOperationsInput | $Enums.payout_status
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    dish_media?: dish_mediaUpdateOneRequiredWithoutPayoutsNestedInput
  }

  export type payoutsUncheckedUpdateWithoutRestaurant_bidsInput = {
    id?: StringFieldUpdateOperationsInput | string
    transfer_id?: StringFieldUpdateOperationsInput | string
    dish_media_id?: StringFieldUpdateOperationsInput | string
    amount_cents?: BigIntFieldUpdateOperationsInput | bigint | number
    currency_code?: NullableStringFieldUpdateOperationsInput | string | null
    status?: Enumpayout_statusFieldUpdateOperationsInput | $Enums.payout_status
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
  }

  export type payoutsUncheckedUpdateManyWithoutRestaurant_bidsInput = {
    id?: StringFieldUpdateOperationsInput | string
    transfer_id?: StringFieldUpdateOperationsInput | string
    dish_media_id?: StringFieldUpdateOperationsInput | string
    amount_cents?: BigIntFieldUpdateOperationsInput | bigint | number
    currency_code?: NullableStringFieldUpdateOperationsInput | string | null
    status?: Enumpayout_statusFieldUpdateOperationsInput | $Enums.payout_status
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
  }

  export type dishesUpdateWithoutRestaurantsInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    dish_media?: dish_mediaUpdateManyWithoutDishesNestedInput
    dish_reviews?: dish_reviewsUpdateManyWithoutDishesNestedInput
    dish_categories?: dish_categoriesUpdateOneRequiredWithoutDishesNestedInput
  }

  export type dishesUncheckedUpdateWithoutRestaurantsInput = {
    id?: StringFieldUpdateOperationsInput | string
    category_id?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    dish_media?: dish_mediaUncheckedUpdateManyWithoutDishesNestedInput
    dish_reviews?: dish_reviewsUncheckedUpdateManyWithoutDishesNestedInput
  }

  export type dishesCreateManyRestaurantsInput = {
    id?: string
    category_id: string
    name?: string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
  }

  export type dishesUncheckedUpdateManyWithoutRestaurantsInput = {
    id?: StringFieldUpdateOperationsInput | string
    category_id?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
  }

  export type restaurant_bidsUpdateWithoutRestaurantsInput = {
    id?: StringFieldUpdateOperationsInput | string
    payment_intent_id?: NullableStringFieldUpdateOperationsInput | string | null
    amount_cents?: BigIntFieldUpdateOperationsInput | bigint | number
    currency_code?: StringFieldUpdateOperationsInput | string
    start_date?: DateTimeFieldUpdateOperationsInput | Date | string
    end_date?: DateTimeFieldUpdateOperationsInput | Date | string
    status?: Enumrestaurant_bid_statusFieldUpdateOperationsInput | $Enums.restaurant_bid_status
    refund_id?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    payouts?: payoutsUpdateManyWithoutRestaurant_bidsNestedInput
    users?: usersUpdateOneRequiredWithoutRestaurant_bidsNestedInput
  }

  export type restaurant_bidsUncheckedUpdateWithoutRestaurantsInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    payment_intent_id?: NullableStringFieldUpdateOperationsInput | string | null
    amount_cents?: BigIntFieldUpdateOperationsInput | bigint | number
    currency_code?: StringFieldUpdateOperationsInput | string
    start_date?: DateTimeFieldUpdateOperationsInput | Date | string
    end_date?: DateTimeFieldUpdateOperationsInput | Date | string
    status?: Enumrestaurant_bid_statusFieldUpdateOperationsInput | $Enums.restaurant_bid_status
    refund_id?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    payouts?: payoutsUncheckedUpdateManyWithoutRestaurant_bidsNestedInput
  }

  export type restaurant_bidsCreateManyRestaurantsInput = {
    id?: string
    user_id: string
    payment_intent_id?: string | null
    amount_cents: bigint | number
    currency_code: string
    start_date: Date | string
    end_date: Date | string
    status: $Enums.restaurant_bid_status
    refund_id?: string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
  }

  export type restaurant_bidsUncheckedUpdateManyWithoutRestaurantsInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    payment_intent_id?: NullableStringFieldUpdateOperationsInput | string | null
    amount_cents?: BigIntFieldUpdateOperationsInput | bigint | number
    currency_code?: StringFieldUpdateOperationsInput | string
    start_date?: DateTimeFieldUpdateOperationsInput | Date | string
    end_date?: DateTimeFieldUpdateOperationsInput | Date | string
    status?: Enumrestaurant_bid_statusFieldUpdateOperationsInput | $Enums.restaurant_bid_status
    refund_id?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
  }

  export type dish_likesCreateManyUsersInput = {
    id?: string
    dish_media_id: string
    created_at?: Date | string
  }

  export type dish_mediaCreateManyUsersInput = {
    id?: string
    dish_id: string
    media_path: string
    media_type: string
    thumbnail_path?: string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
  }

  export type dish_reviewsCreateManyUsersInput = {
    id?: string
    dish_id: string
    comment: string
    rating: number
    price_cents?: number | null
    currency_code?: string | null
    created_dish_media_id?: string | null
    imported_user_name?: string | null
    imported_user_avatar?: string | null
    created_at?: Date | string
  }

  export type restaurant_bidsCreateManyUsersInput = {
    id?: string
    restaurant_id: string
    payment_intent_id?: string | null
    amount_cents: bigint | number
    currency_code: string
    start_date: Date | string
    end_date: Date | string
    status: $Enums.restaurant_bid_status
    refund_id?: string | null
    created_at?: Date | string
    updated_at?: Date | string
    lock_no?: number
  }

  export type dish_likesUpdateWithoutUsersInput = {
    id?: StringFieldUpdateOperationsInput | string
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    dish_media?: dish_mediaUpdateOneRequiredWithoutDish_likesNestedInput
  }

  export type dish_likesUncheckedUpdateWithoutUsersInput = {
    id?: StringFieldUpdateOperationsInput | string
    dish_media_id?: StringFieldUpdateOperationsInput | string
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type dish_likesUncheckedUpdateManyWithoutUsersInput = {
    id?: StringFieldUpdateOperationsInput | string
    dish_media_id?: StringFieldUpdateOperationsInput | string
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type dish_mediaUpdateWithoutUsersInput = {
    id?: StringFieldUpdateOperationsInput | string
    media_path?: StringFieldUpdateOperationsInput | string
    media_type?: StringFieldUpdateOperationsInput | string
    thumbnail_path?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    dish_likes?: dish_likesUpdateManyWithoutDish_mediaNestedInput
    dishes?: dishesUpdateOneRequiredWithoutDish_mediaNestedInput
    payouts?: payoutsUpdateManyWithoutDish_mediaNestedInput
  }

  export type dish_mediaUncheckedUpdateWithoutUsersInput = {
    id?: StringFieldUpdateOperationsInput | string
    dish_id?: StringFieldUpdateOperationsInput | string
    media_path?: StringFieldUpdateOperationsInput | string
    media_type?: StringFieldUpdateOperationsInput | string
    thumbnail_path?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    dish_likes?: dish_likesUncheckedUpdateManyWithoutDish_mediaNestedInput
    payouts?: payoutsUncheckedUpdateManyWithoutDish_mediaNestedInput
  }

  export type dish_mediaUncheckedUpdateManyWithoutUsersInput = {
    id?: StringFieldUpdateOperationsInput | string
    dish_id?: StringFieldUpdateOperationsInput | string
    media_path?: StringFieldUpdateOperationsInput | string
    media_type?: StringFieldUpdateOperationsInput | string
    thumbnail_path?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
  }

  export type dish_reviewsUpdateWithoutUsersInput = {
    id?: StringFieldUpdateOperationsInput | string
    comment?: StringFieldUpdateOperationsInput | string
    rating?: IntFieldUpdateOperationsInput | number
    price_cents?: NullableIntFieldUpdateOperationsInput | number | null
    currency_code?: NullableStringFieldUpdateOperationsInput | string | null
    created_dish_media_id?: NullableStringFieldUpdateOperationsInput | string | null
    imported_user_name?: NullableStringFieldUpdateOperationsInput | string | null
    imported_user_avatar?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    dishes?: dishesUpdateOneRequiredWithoutDish_reviewsNestedInput
  }

  export type dish_reviewsUncheckedUpdateWithoutUsersInput = {
    id?: StringFieldUpdateOperationsInput | string
    dish_id?: StringFieldUpdateOperationsInput | string
    comment?: StringFieldUpdateOperationsInput | string
    rating?: IntFieldUpdateOperationsInput | number
    price_cents?: NullableIntFieldUpdateOperationsInput | number | null
    currency_code?: NullableStringFieldUpdateOperationsInput | string | null
    created_dish_media_id?: NullableStringFieldUpdateOperationsInput | string | null
    imported_user_name?: NullableStringFieldUpdateOperationsInput | string | null
    imported_user_avatar?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type dish_reviewsUncheckedUpdateManyWithoutUsersInput = {
    id?: StringFieldUpdateOperationsInput | string
    dish_id?: StringFieldUpdateOperationsInput | string
    comment?: StringFieldUpdateOperationsInput | string
    rating?: IntFieldUpdateOperationsInput | number
    price_cents?: NullableIntFieldUpdateOperationsInput | number | null
    currency_code?: NullableStringFieldUpdateOperationsInput | string | null
    created_dish_media_id?: NullableStringFieldUpdateOperationsInput | string | null
    imported_user_name?: NullableStringFieldUpdateOperationsInput | string | null
    imported_user_avatar?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type restaurant_bidsUpdateWithoutUsersInput = {
    id?: StringFieldUpdateOperationsInput | string
    payment_intent_id?: NullableStringFieldUpdateOperationsInput | string | null
    amount_cents?: BigIntFieldUpdateOperationsInput | bigint | number
    currency_code?: StringFieldUpdateOperationsInput | string
    start_date?: DateTimeFieldUpdateOperationsInput | Date | string
    end_date?: DateTimeFieldUpdateOperationsInput | Date | string
    status?: Enumrestaurant_bid_statusFieldUpdateOperationsInput | $Enums.restaurant_bid_status
    refund_id?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    payouts?: payoutsUpdateManyWithoutRestaurant_bidsNestedInput
    restaurants?: restaurantsUpdateOneRequiredWithoutRestaurant_bidsNestedInput
  }

  export type restaurant_bidsUncheckedUpdateWithoutUsersInput = {
    id?: StringFieldUpdateOperationsInput | string
    restaurant_id?: StringFieldUpdateOperationsInput | string
    payment_intent_id?: NullableStringFieldUpdateOperationsInput | string | null
    amount_cents?: BigIntFieldUpdateOperationsInput | bigint | number
    currency_code?: StringFieldUpdateOperationsInput | string
    start_date?: DateTimeFieldUpdateOperationsInput | Date | string
    end_date?: DateTimeFieldUpdateOperationsInput | Date | string
    status?: Enumrestaurant_bid_statusFieldUpdateOperationsInput | $Enums.restaurant_bid_status
    refund_id?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
    payouts?: payoutsUncheckedUpdateManyWithoutRestaurant_bidsNestedInput
  }

  export type restaurant_bidsUncheckedUpdateManyWithoutUsersInput = {
    id?: StringFieldUpdateOperationsInput | string
    restaurant_id?: StringFieldUpdateOperationsInput | string
    payment_intent_id?: NullableStringFieldUpdateOperationsInput | string | null
    amount_cents?: BigIntFieldUpdateOperationsInput | bigint | number
    currency_code?: StringFieldUpdateOperationsInput | string
    start_date?: DateTimeFieldUpdateOperationsInput | Date | string
    end_date?: DateTimeFieldUpdateOperationsInput | Date | string
    status?: Enumrestaurant_bid_statusFieldUpdateOperationsInput | $Enums.restaurant_bid_status
    refund_id?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    lock_no?: IntFieldUpdateOperationsInput | number
  }



  /**
   * Batch Payload for updateMany & deleteMany & createMany
   */

  export type BatchPayload = {
    count: number
  }

  /**
   * DMMF
   */
  export const dmmf: runtime.BaseDMMF
}