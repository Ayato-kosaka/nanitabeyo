/**
 * 指定された型の全フィールドから `null` を除外する（shallow only）。
 *
 * @example
 * type A = { foo: string | null, bar: number };
 * type B = DeepNonNullable<A>; // { foo: string, bar: number }
 */
export type DeepNonNullable<T> = {
    [K in keyof T]: Exclude<T[K], null>;
};

/**
 * 指定された型から `null` を深く再帰的に除外するユーティリティ型。
 * 関数はそのまま残し、配列・ネストオブジェクトに対しても適用される。
 *
 * @example
 * type A = { foo: { bar: string | null } | null };
 * type B = DeepStrictNonNullable<A>; // { foo: { bar: string } }
 */
export type DeepStrictNonNullable<T> = {
    [K in keyof T]: T[K] extends (...args: any) => any
    ? T[K]
    : T[K] extends Array<infer U>
    ? Array<DeepStrictNonNullable<Exclude<U, null>>>
    : T[K] extends object
    ? DeepStrictNonNullable<Exclude<T[K], null>>
    : Exclude<T[K], null>;
};

/**
 * 型 T のすべてのプロパティを再帰的に必須（required）にする。
 *
 * @example
 * type A = { foo?: { bar?: string } };
 * type B = DeepRequired<A>; // { foo: { bar: string } }
 */
export type DeepRequired<T> = {
    [K in keyof T]-?: T[K] extends (...args: any) => any
    ? T[K]
    : T[K] extends Array<infer U>
    ? Array<DeepRequired<U>>
    : T[K] extends object
    ? DeepRequired<T[K]>
    : T[K];
};

/**
 * 型 T のすべてのプロパティを再帰的に省略可能（optional）にする。
 *
 * @example
 * type A = { foo: { bar: string } };
 * type B = DeepPartial<A>; // { foo?: { bar?: string } }
 */
export type DeepPartial<T> = {
    [K in keyof T]?: T[K] extends (...args: any) => any
    ? T[K]
    : T[K] extends Array<infer U>
    ? Array<DeepPartial<U>>
    : T[K] extends object
    ? DeepPartial<T[K]>
    : T[K];
};

/**
 * 型 T のすべてのプロパティを再帰的に `readonly` にする。
 *
 * @example
 * type A = { foo: { bar: string } };
 * type B = DeepReadonly<A>; // { readonly foo: { readonly bar: string } }
 */
export type DeepReadonly<T> = {
    readonly [K in keyof T]: T[K] extends (...args: any) => any
    ? T[K]
    : T[K] extends Array<infer U>
    ? ReadonlyArray<DeepReadonly<U>>
    : T[K] extends object
    ? DeepReadonly<T[K]>
    : T[K];
};

/**
 * 指定された関数型の引数型を取得する。
 *
 * @example
 * type RequestType<T> = T extends (req: infer R) => any ? R : never;
 * type A = RequestType<() => void>; // void
 * type B = RequestType<(req: { foo: string }) => void>; // { foo: string }
 */
export type RequestType<T> = T extends (req: infer R) => any ? R : never;
