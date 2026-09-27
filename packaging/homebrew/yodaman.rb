# Homebrew formula for YodaMan.
#
# This file lives here so it is versioned alongside the release it describes.
# To publish it, copy it into a tap repository named `Yoda-Man/homebrew-yodaman`
# as `Formula/yodaman.rb`; users then install with:
#
#     brew install Yoda-Man/yodaman/yodaman
#
# The url and sha256 must be updated on every release. `scripts/brew-formula.js`
# regenerates both from the published npm tarball so they cannot be typed wrong.
class Yodaman < Formula
  desc "Local-first workspace intelligence: semantic search, knowledge graph, spec drift"
  homepage "https://github.com/Yoda-Man/yodaman"
  url "https://registry.npmjs.org/yodaman/-/yodaman-0.5.6.tgz"
  sha256 "5c6982308139824d1296f791976ad73ace73424c1c12261f45bc4173eeb11688"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  def caveats
    <<~EOS
      YodaMan needs a local model runner and three companion tools.
      Install them with:

        yodaman setup

      Ollama is not installed automatically — it is a system service, so
      `yodaman setup` prints the command and leaves the decision to you.
    EOS
  end

  test do
    # Exercise the CLI rather than just asserting the files are on disk: both
    # subcommands must exit instead of starting the runtime, and a regression
    # there hangs `brew test` rather than failing it.
    assert_match version.to_s, shell_output("#{bin}/yodaman --version")
    assert_match "yodaman setup", shell_output("#{bin}/yodaman --help")

    # Nothing above covers the second executable.
    assert_predicate bin/"yodaman-mcp", :exist?
  end
end
