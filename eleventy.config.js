const sitemap = require("@nichoth/eleventy-plugin-sitemap");

module.exports = function (eleventyConfig) {
  // Copy asset statis apa adanya
  eleventyConfig.addPassthroughCopy({"src/_css": "css"});
  eleventyConfig.addPassthroughCopy("src/js");
  eleventyConfig.addPassthroughCopy("src/data");
  eleventyConfig.addPassthroughCopy("src/img");
  eleventyConfig.addPassthroughCopy({"src/robots.txt": "robots.txt"});

  // Watch file JS & data agar live reload
  eleventyConfig.addWatchTarget("src/_css/");
  eleventyConfig.addWatchTarget("src/js/");

  // Filter bantu: format rupiah
  eleventyConfig.addFilter("rupiah", (angka) => {
    return "Rp " + Number(angka).toLocaleString("id-ID");
  });
  
  //eleventyConfig.addFilter("toArray", (obj) => Object.values(obj));
  
  eleventyConfig.addPlugin(sitemap, {
    sitemap: {
      hostname: "https://website-iksan.mardpharm86.workers.dev",
    },
  });

  //eleventyConfig.setWatchThrottleWaitTime(200);

  //eleventyConfig.setUseGitIgnore(false);

  return {
    dir: {
      input: "src",
      output: "public",
      includes: "_includes",
      data: "_data",
    },
    templateFormats: ["njk", "html", "md"],
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk",
  };
};
