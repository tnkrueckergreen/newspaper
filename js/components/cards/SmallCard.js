import { ArticleCard } from './ArticleCard.js';

export function SmallCard(article) {
    return ArticleCard(article, {
        className: 'article-card-small',
        titleTag: 'h4',
        titleClass: 'article-title-small',
        showExcerpt: true,
        showAuthors: true,
        imageLoading: 'lazy'
    });
}