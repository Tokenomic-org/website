require 'webrick'

root = File.join(__dir__, '_site')
server = WEBrick::HTTPServer.new(
  Port: 5000,
  BindAddress: '0.0.0.0',
  DocumentRoot: root,
  AccessLog: [],
  Logger: WEBrick::Log.new($stdout, WEBrick::Log::INFO)
)

trap('INT') { server.shutdown }
trap('TERM') { server.shutdown }

server.start
