export type NonNullableFields<T> = {
  [P in keyof T]: NonNullable<T[P]>;
};

export type NonNullableField<T, K extends keyof T> = Omit<T, K> & {
  [P in keyof T]: NonNullable<T[P]>;
};

export type NullableFields<T> = {
  [P in keyof T]: T[P] | null;
};

export type NullableField<T, K extends keyof T> = Omit<T, K> & {
  [P in K]: T[P] | null;
};
