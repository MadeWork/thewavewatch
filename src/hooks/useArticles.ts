import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/integrations/supabase/client'

export function useArticles(topicId?: string) {
  const [articles, setArticles] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [newCount, setNewCount] = useState(0)

  const loadArticles = useCallback(async () => {
    setIsLoading(true)

    let query = supabase
      .from('articles')
      .select('*, sources(name, region, country_code)')
      .eq('is_duplicate', false)
      .neq('source_category', 'social' as any)
      .order('published_at', { ascending: false })
      .limit(500)

    if (topicId) query = query.eq('topic_id', topicId)

    const { data } = await query
    setArticles(data ?? [])
    setIsLoading(false)
  }, [topicId])

  useEffect(() => {
    loadArticles()

    const channel = supabase
      .channel(`articles-realtime-${topicId ?? 'all'}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'articles',
          ...(topicId ? { filter: `topic_id=eq.${topicId}` } : {})
        },
        (payload) => {
          const newArticle = payload.new as any
          if (newArticle.is_duplicate) return
          if (newArticle.relevance_label === 'noise') return

          setArticles(prev => {
            if (prev.some(a => a.id === newArticle.id)) return prev
            return [newArticle, ...prev]
          })

          setNewCount(prev => prev + 1)
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [topicId, loadArticles])

  return { articles, isLoading, newCount, setNewCount, refetch: loadArticles }
}
