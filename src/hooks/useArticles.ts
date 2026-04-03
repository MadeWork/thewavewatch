import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '@/integrations/supabase/client'

export function useArticles(topicId?: string) {
  const [articles, setArticles] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [newCount, setNewCount] = useState(0)
  const [connected, setConnected] = useState(false)
  const channelRef = useRef<any>(null)

  const loadArticles = useCallback(async () => {
    setIsLoading(true)
    let query = supabase
      .from('articles')
      .select('*')
      .or('is_duplicate.eq.false,is_duplicate.is.null')
      .or('relevance_label.neq.noise,relevance_label.is.null')
      .order('published_at', { ascending: false })
      .limit(200)
    if (topicId) query = query.eq('topic_id', topicId)
    const { data, error } = await query
    console.log('useArticles result:', { count: data?.length, error: error?.message, firstTitle: data?.[0]?.title })
    if (error) console.error('useArticles load error:', error.message)
    setArticles(data ?? [])
    setIsLoading(false)
  }, [topicId])

  useEffect(() => {
    loadArticles()
    if (channelRef.current) supabase.removeChannel(channelRef.current)
    const channel = supabase
      .channel(`articles-rt-${topicId ?? 'all'}-${Date.now()}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'articles', ...(topicId ? { filter: `topic_id=eq.${topicId}` } : {}) },
        (payload) => {
          const a = payload.new as any
          if (a.is_duplicate) return
          if (a.relevance_label === 'noise') return
          console.log('⚡ Real-time article:', a.title)
          setArticles(prev => prev.some(x => x.id === a.id) ? prev : [a, ...prev])
          setNewCount(prev => prev + 1)
        }
      )
      .subscribe((status) => {
        console.log('Real-time status:', status)
        setConnected(status === 'SUBSCRIBED')
      })
    channelRef.current = channel
    return () => { if (channelRef.current) { supabase.removeChannel(channelRef.current); channelRef.current = null } }
  }, [topicId, loadArticles])

  return { articles, isLoading, newCount, setNewCount, connected, refetch: loadArticles }
}
