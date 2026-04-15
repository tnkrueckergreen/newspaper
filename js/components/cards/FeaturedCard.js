import { ArticleCard } from './ArticleCard.js';

export function FeaturedCard(article) {
    return ArticleCard(article, {
        className: 'featured-card',
        titleTag: 'h3',
        titleClass: 'article-title-large',
        showExcerpt: true,
        showAuthors: true,
        imageLoading: 'eager'
    });
}