import { useCallback, useRef, useState } from "react";

type Fetcher<TReq, TItem> = (params: {
        cursor?: string | null;
        request?: TReq;
}) => Promise<{ data: TItem[]; nextCursor?: string | null }>;

export const useCursorPagination = <TReq, TItem>(fetcher: Fetcher<TReq, TItem>) => {
        const [items, setItems] = useState<TItem[]>([]);
        const [nextCursor, setNextCursor] = useState<string | null>(null);
        const [isLoadingInitial, setIsLoadingInitial] = useState(false);
        const [isLoadingMore, setIsLoadingMore] = useState(false);
        const [error, setError] = useState<unknown>(null);
        const requestRef = useRef<TReq | undefined>(undefined);

        const loadInitial = useCallback(async (request?: TReq) => {
                requestRef.current = request;
                setIsLoadingInitial(true);
                setError(null);
                try {
                        const response = await fetcher({ request });
                        setItems(response.data);
                        setNextCursor(response.nextCursor ?? null);
                } catch (err) {
                        setError(err);
                        setItems([]);
                        setNextCursor(null);
                } finally {
                        setIsLoadingInitial(false);
                }
        }, [fetcher]);

        const loadMore = useCallback(async () => {
                if (isLoadingMore || nextCursor === null) return;
                setIsLoadingMore(true);
                setError(null);
                try {
                        const response = await fetcher({ cursor: nextCursor, request: requestRef.current });
                        setItems((prev) => [...prev, ...response.data]);
                        setNextCursor(response.nextCursor ?? null);
                } catch (err) {
                        setError(err);
                } finally {
                        setIsLoadingMore(false);
                }
        }, [fetcher, nextCursor, isLoadingMore]);

        const refresh = useCallback(async () => {
                await loadInitial(requestRef.current);
        }, [loadInitial]);

        return {
                items,
                loadInitial,
                loadMore,
                refresh,
                error,
                isLoadingInitial,
                isLoadingMore,
                hasNextPage: nextCursor !== null,
        };
};

export type CursorPaginationResult<TReq, TItem> = ReturnType<typeof useCursorPagination<TReq, TItem>>;
