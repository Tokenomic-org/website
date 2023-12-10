source "https://rubygems.org"

gem "jekyll", "~> 3.8.7"
gem "minima", "~> 2.5"
# Uncomment below line if you are using GitHub Pages
# gem "github-pages", group: :jekyll_plugins

group :jekyll_plugins do
  gem "jekyll-feed", "~> 0.12"
  gem "jekyll-paginate-v2" # Consider specifying a version
  gem "jekyll-tagging"     # Consider specifying a version
  gem "jekyll-archives"    # Consider specifying a version
end

install_if -> { RUBY_PLATFORM =~ %r!mingw|mswin|java! } do
  gem "tzinfo", "~> 1.2"
  gem "tzinfo-data"
end

gem "wdm", "~> 0.1.1", :install_if => Gem.win_platform?


# Performance-booster for watching directories on Windows
gem "wdm", "~> 0.1.1", :install_if => Gem.win_platform?

