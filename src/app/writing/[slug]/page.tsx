import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicThreadArticle } from "@/components/PublicThreadArticle";
import { ARTICLES, articleBySlug } from "@/content/articles";
import { PLAYGROUND } from "@/lib/playground";
import { articleMetadata, articleSchema } from "@/lib/seo";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return ARTICLES.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const article = articleBySlug(slug);
  if (!article) return {};
  return articleMetadata(PLAYGROUND, article);
}

export default async function ArticlePage({ params }: Props) {
  if (!PLAYGROUND) notFound();
  const { slug } = await params;
  const article = articleBySlug(slug);
  if (!article) notFound();
  const schema = articleSchema(article);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
      <PublicThreadArticle article={article} />
    </>
  );
}
