function calculateScore(articleA, articleB) {
    let score = 0;

    const commonTags = articleA.tags.filter(tag => articleB.tags.includes(tag));
    score += commonTags.length * 5;

    if (articleA.category === articleB.category) {
        score += 2;
    }

    return score;
}

export function getRecommendedArticles(currentArticle, allArticles, count = 4) {
    const recommendations = allArticles
        .filter(article => article.id !== currentArticle.id)
        .map(article => ({
            ...article,
            score: calculateScore(currentArticle, article)
        }))
        .filter(article => article.score > 0)
        .sort((a, b) => {
            if (b.score !== a.score) {
                return b.score - a.score;
            }
            return new Date(b.date) - new Date(a.date);
        });

    return recommendations.slice(0, count);
}