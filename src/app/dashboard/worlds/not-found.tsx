import Link from 'next/link';

export default function WorldNotFound() {
  return (
    <section className='mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-4 px-6 text-center'>
      <p className='text-muted-foreground text-sm'>404 · 世界不存在</p>
      <h1 className='text-2xl font-semibold'>世界不存在或已移除</h1>
      <p className='text-muted-foreground text-sm'>
        这个链接对应的世界不在当前列表中。请从世界列表选择要继续编辑的世界。
      </p>
      <Link
        href='/dashboard/overview'
        className='bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2 text-sm font-medium'
      >
        返回世界列表
      </Link>
    </section>
  );
}
