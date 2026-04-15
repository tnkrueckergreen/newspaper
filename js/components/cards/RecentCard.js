import { ArticleCard } from './ArticleCard.js';

export function RecentCard(article) {
    return ArticleCard(article, {
        className: 'recent-card',
        titleTag: 'h4',
        titleClass: 'article-title-small',
        showExcerpt: true,
        showAuthors: true,
        imageLoading: 'lazy'
    });
}